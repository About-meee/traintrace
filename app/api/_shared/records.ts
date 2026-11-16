import {
  and,
  desc,
  eq,
  exists,
  gte,
  gt,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import { accountSecrets, trainingRecords, trainingSessions } from "@/db/schema";
import { HttpError, isDocumentSessionActive, isPlainObject } from "@/app/api/_shared";

const templates = {
  weight: { allowed: ["weight", "reps", "assistanceKg"], required: ["weight", "reps"] },
  body: { allowed: ["reps"], required: ["reps"] },
  assisted: { allowed: ["assistanceKg", "reps"], required: ["assistanceKg", "reps"] },
  time: { allowed: ["seconds"], required: ["seconds"] },
  distance: { allowed: ["km"], required: ["km"] },
  cardio: { allowed: ["seconds", "km"], required: [] },
} as const;

type Template = keyof typeof templates;
const partIds = new Set(["chest", "back", "shoulders", "arms", "legs", "core", "cardio"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESET_EXERCISE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RecordObject = {
  id: string;
  part: string;
  exerciseId: string;
  name: string;
  template: Template;
  date: string;
  startedAt: string;
  completedAt: string;
  groups: Array<Record<string, number>>;
  fatigue: number;
};

export type TrainingRecordQuery =
  | { mode: "all" }
  | { mode: "date_range"; fromDate: string; throughDate: string };

export type TrainingRecordPage = {
  records: RecordObject[];
  hasMore: boolean;
  nextCursor: string | null;
};

function invalid(message: string): never {
  throw new HttpError(400, "INVALID_ARGUMENT", message);
}

function realDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    invalid(`${field} must be a real calendar date.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    invalid(`${field} must be an ISO 8601 timestamp with a timezone.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) invalid(`${field} is not a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function validateFiniteNumber(
  value: unknown,
  field: string,
  options: { minimum?: number; integer?: boolean } = {},
): asserts value is number {
  const minimum = options.minimum ?? 0;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    (options.integer && !Number.isSafeInteger(value))
  ) {
    invalid(`${field} must be a finite number >= ${minimum}.`);
  }
}

function normalizeRecord(value: unknown): RecordObject {
  if (!isPlainObject(value)) invalid("record must be an object.");
  const expected = [
    "id", "part", "exerciseId", "name", "template", "date",
    "startedAt", "completedAt", "groups", "fatigue",
  ];
  if (Object.keys(value).some((key) => !expected.includes(key))) {
    invalid("record contains an unsupported field.");
  }
  for (const field of ["id", "part", "exerciseId", "name"] as const) {
    const item = value[field];
    if (typeof item !== "string" || item.trim() === "" || item.length > 200) {
      invalid(`${field} must be a non-empty string up to 200 characters.`);
    }
  }
  if (typeof value.template !== "string" || !Object.hasOwn(templates, value.template)) {
    invalid("template is not supported.");
  }
  const template = value.template as Template;
  const date = realDate(value.date, "date");
  const startedAt = timestamp(value.startedAt, "startedAt");
  const completedAt = timestamp(value.completedAt, "completedAt");
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    invalid("completedAt must not precede startedAt.");
  }
  if (!Array.isArray(value.groups) || value.groups.length < 1 || value.groups.length > 100) {
    invalid("groups must contain between 1 and 100 entries.");
  }
  const groupRules = templates[template];
  for (const [index, candidate] of value.groups.entries()) {
    if (!isPlainObject(candidate)) invalid(`groups[${index}] must be an object.`);
    const allowed = new Set<string>(groupRules.allowed);
    for (const key of Object.keys(candidate)) {
      if (!allowed.has(key)) invalid(`groups[${index}].${key} is not valid for ${template}.`);
    }
    for (const key of groupRules.required) {
      if (!Object.hasOwn(candidate, key)) invalid(`groups[${index}].${key} is required.`);
    }
    if (
      template === "cardio" &&
      !Object.hasOwn(candidate, "seconds") &&
      !Object.hasOwn(candidate, "km")
    ) {
      invalid(`groups[${index}] requires seconds, km, or both.`);
    }
    for (const [key, number] of Object.entries(candidate)) {
      validateFiniteNumber(number, `groups[${index}].${key}`, {
        minimum: key === "reps" ? 1 : 0,
        integer: key === "reps",
      });
      if ((key === "seconds" || key === "km") && number === 0) {
        invalid(`groups[${index}].${key} must be greater than zero.`);
      }
    }
  }
  validateFiniteNumber(value.fatigue, "fatigue", { integer: true });

  return {
    id: value.id as string,
    part: value.part as string,
    exerciseId: value.exerciseId as string,
    name: value.name as string,
    template,
    date,
    startedAt,
    completedAt,
    groups: value.groups as Array<Record<string, number>>,
    fatigue: value.fatigue,
  };
}

function validateRecordIdentifiers(record: RecordObject): void {
  if (!UUID_PATTERN.test(record.id)) {
    invalid("id must be a UUID.");
  }
  if (!partIds.has(record.part)) {
    invalid("part must be one of the supported training areas.");
  }
  if (record.exerciseId.startsWith("custom-")) {
    if (!UUID_PATTERN.test(record.exerciseId.slice("custom-".length))) {
      invalid("custom exerciseId must be custom- followed by a UUID.");
    }
  } else if (!PRESET_EXERCISE_ID_PATTERN.test(record.exerciseId)) {
    invalid("preset exerciseId must use a stable lowercase slug.");
  }
}

export function normalizeTrainingRecord(value: unknown): RecordObject {
  const record = normalizeRecord(value);
  validateRecordIdentifiers(record);
  return record;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function saveTrainingRecordForUser(
  ownerUserId: string,
  sessionHash: string,
  input: unknown,
): Promise<{ record: RecordObject; created: boolean }> {
  // Check for an existing id before enforcing the new identifier rules. This keeps
  // retries of records saved under the previous contract idempotent without making
  // those legacy identifiers valid for new inserts.
  const record = normalizeRecord(input);
  const payloadJson = canonicalJson(record);
  const db = getDb();
  const activeSession = exists(
    db
      .select({ value: sql`1` })
      .from(trainingSessions)
      .where(
        and(
          eq(trainingSessions.sessionHash, sessionHash),
          eq(trainingSessions.ownerUserId, ownerUserId),
          gt(trainingSessions.expiresAt, Date.now()),
        ),
      ),
  );
  const existing = await db
    .select({ payloadJson: trainingRecords.payloadJson })
    .from(trainingRecords)
    .where(
      and(
        eq(trainingRecords.ownerUserId, ownerUserId),
        eq(trainingRecords.recordId, record.id),
        activeSession,
      ),
    )
    .get();

  if (existing) {
    if (existing.payloadJson !== payloadJson) {
      throw new HttpError(409, "RECORD_CONFLICT", "A saved record cannot be changed.");
    }
    return { record, created: false };
  }

  validateRecordIdentifiers(record);

  // Recheck the active document in the mutation statement itself. A request
  // authorized before another device takes over must not write afterward.
  const inserted = await db.run(sql`
    INSERT INTO training_records
      (owner_user_id, record_id, local_date, completed_at, payload_json)
    SELECT ${ownerUserId}, ${record.id}, ${record.date}, ${record.completedAt}, ${payloadJson}
    WHERE EXISTS (
      SELECT 1 FROM training_sessions
      WHERE session_hash = ${sessionHash}
        AND owner_user_id = ${ownerUserId}
        AND expires_at > ${Date.now()}
    )
    ON CONFLICT(owner_user_id, record_id) DO NOTHING
  `);

  const persisted = await db
    .select({ payloadJson: trainingRecords.payloadJson })
    .from(trainingRecords)
    .where(
      and(
        eq(trainingRecords.ownerUserId, ownerUserId),
        eq(trainingRecords.recordId, record.id),
        activeSession,
      ),
    )
    .get();
  if (!persisted) {
    if (!(await isDocumentSessionActive(ownerUserId, sessionHash))) {
      throw new HttpError(401, "SESSION_REPLACED", "This TRAINTRACE session was replaced or expired.");
    }
    throw new HttpError(500, "INTERNAL_ERROR", "Record could not be saved.");
  }
  if (persisted.payloadJson !== payloadJson) {
    throw new HttpError(409, "RECORD_CONFLICT", "A saved record cannot be changed.");
  }
  return {
    record: JSON.parse(persisted.payloadJson) as RecordObject,
    created: inserted.meta.changes > 0,
  };
}

type CursorData = {
  v: 2;
  mode: "all" | "date_range";
  fromDate: string | null;
  throughDate: string | null;
  limit: number;
  snapshotSeq: number;
  last: { date: string; completedAt: string; id: string } | null;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid("cursor encoding is invalid.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function cursorSecret(ownerUserId: string): Promise<Uint8Array> {
  const db = getDb();
  let secret = await db
    .select({ cursorSecret: accountSecrets.cursorSecret })
    .from(accountSecrets)
    .where(eq(accountSecrets.ownerUserId, ownerUserId))
    .get();
  if (!secret) {
    const random = new Uint8Array(32);
    crypto.getRandomValues(random);
    const value = toBase64Url(random);
    await db
      .insert(accountSecrets)
      .values({ ownerUserId, cursorSecret: value })
      .onConflictDoNothing({ target: accountSecrets.ownerUserId });
    secret = await db
      .select({ cursorSecret: accountSecrets.cursorSecret })
      .from(accountSecrets)
      .where(eq(accountSecrets.ownerUserId, ownerUserId))
      .get();
    if (!secret) throw new HttpError(500, "INTERNAL_ERROR", "Could not create a query cursor.");
  }
  const rawKey = fromBase64Url(secret.cursorSecret);
  if (rawKey.length !== 32) {
    throw new HttpError(500, "INTERNAL_ERROR", "The query cursor secret is invalid.");
  }
  return rawKey;
}

async function cursorEncryptionKey(ownerUserId: string): Promise<CryptoKey> {
  const rawSecret = await cursorSecret(ownerUserId);
  const secretBuffer = rawSecret.slice().buffer as ArrayBuffer;
  const derivationKey = await crypto.subtle.importKey(
    "raw",
    secretBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encryptionKeyBytes = await crypto.subtle.sign(
    "HMAC",
    derivationKey,
    new TextEncoder().encode("TRAINTRACE:cursor-encryption:v2"),
  );
  return crypto.subtle.importKey("raw", encryptionKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encodeCursor(ownerUserId: string, data: CursorData): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(`TRAINTRACE:cursor:v2:${ownerUserId}`).buffer as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, additionalData },
    await cursorEncryptionKey(ownerUserId),
    new TextEncoder().encode(JSON.stringify(data)).buffer as ArrayBuffer,
  );
  return `v2.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

async function decodeCursor(
  ownerUserId: string,
  cursor: string,
  expected: Pick<CursorData, "mode" | "fromDate" | "throughDate" | "limit">,
): Promise<CursorData> {
  const [version, encodedIv, encodedCiphertext, extra] = cursor.split(".");
  if (version !== "v2" || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new HttpError(400, "INVALID_CURSOR", "Cursor is malformed or has expired.");
  }
  let data: unknown;
  try {
    const iv = fromBase64Url(encodedIv);
    const ciphertext = fromBase64Url(encodedCiphertext);
    if (iv.length !== 12 || ciphertext.length < 16) {
      throw new Error("Invalid cursor payload size.");
    }
    const additionalData = new TextEncoder().encode(`TRAINTRACE:cursor:v2:${ownerUserId}`).buffer as ArrayBuffer;
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.slice().buffer as ArrayBuffer, additionalData },
      await cursorEncryptionKey(ownerUserId),
      ciphertext.slice().buffer as ArrayBuffer,
    );
    data = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
  } catch {
    throw new HttpError(400, "INVALID_CURSOR", "Cursor is invalid or does not belong to this account.");
  }

  if (!isPlainObject(data)) {
    throw new HttpError(400, "INVALID_CURSOR", "Cursor payload is malformed.");
  }
  const cursorData = data as unknown as CursorData;
  if (
    cursorData.v !== 2 ||
    cursorData.mode !== expected.mode ||
    cursorData.fromDate !== expected.fromDate ||
    cursorData.throughDate !== expected.throughDate ||
    cursorData.limit !== expected.limit ||
    !Number.isSafeInteger(cursorData.snapshotSeq) ||
    cursorData.snapshotSeq < 0 ||
    !isPlainObject(cursorData.last) ||
    typeof cursorData.last.date !== "string" ||
    typeof cursorData.last.completedAt !== "string" ||
    typeof cursorData.last.id !== "string"
  ) {
    throw new HttpError(400, "INVALID_CURSOR", "Cursor does not match this query.");
  }
  return cursorData;
}

export async function listTrainingRecordsForUser(
  ownerUserId: string,
  query: TrainingRecordQuery,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<TrainingRecordPage> {
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new HttpError(400, "INVALID_ARGUMENT", "limit must be an integer from 1 to 20.");
  }
  const mode = query.mode;
  const fromDate = mode === "date_range" ? realDate(query.fromDate, "fromDate") : null;
  const throughDate = mode === "date_range" ? realDate(query.throughDate, "throughDate") : null;
  if (mode === "date_range" && throughDate! < fromDate!) {
    invalid("throughDate must not precede fromDate.");
  }
  const expected = { mode, fromDate, throughDate, limit } as const;
  const db = getDb();
  let pageCursor: CursorData | null = null;
  if (options.cursor) {
    if (options.cursor.length > 4096) {
      throw new HttpError(400, "INVALID_CURSOR", "Cursor is too large.");
    }
    pageCursor = await decodeCursor(ownerUserId, options.cursor, expected);
  } else {
    const max = await db
      .select({ maxSeq: trainingRecords.seq })
      .from(trainingRecords)
      .where(eq(trainingRecords.ownerUserId, ownerUserId))
      .orderBy(desc(trainingRecords.seq))
      .limit(1)
      .get();
    pageCursor = {
      v: 2,
      ...expected,
      snapshotSeq: max?.maxSeq ?? 0,
      last: null,
    };
  }

  const filters = [eq(trainingRecords.ownerUserId, ownerUserId), lte(trainingRecords.seq, pageCursor.snapshotSeq)];
  if (fromDate && throughDate) {
    // SQLite compares ISO calendar dates lexicographically.
    filters.push(gte(trainingRecords.localDate, fromDate));
    filters.push(lte(trainingRecords.localDate, throughDate));
  }
  if (pageCursor.last) {
    const { last } = pageCursor;
    filters.push(
      or(
        lt(trainingRecords.localDate, last.date),
        and(
          eq(trainingRecords.localDate, last.date),
          lt(trainingRecords.completedAt, last.completedAt),
        ),
        and(
          eq(trainingRecords.localDate, last.date),
          eq(trainingRecords.completedAt, last.completedAt),
          lt(trainingRecords.recordId, last.id),
        ),
      )!,
    );
  }

  const fetched = await db
    .select({
      seq: trainingRecords.seq,
      localDate: trainingRecords.localDate,
      completedAt: trainingRecords.completedAt,
      recordId: trainingRecords.recordId,
      payloadJson: trainingRecords.payloadJson,
    })
    .from(trainingRecords)
    .where(and(...filters))
    .orderBy(
      desc(trainingRecords.localDate),
      desc(trainingRecords.completedAt),
      desc(trainingRecords.recordId),
    )
    .limit(limit + 1);
  const hasMore = fetched.length > limit;
  const rows = fetched.slice(0, limit);
  const records = rows.map((row) => JSON.parse(row.payloadJson) as RecordObject);
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? await encodeCursor(ownerUserId, {
          ...pageCursor,
          last: {
            date: last.localDate,
            completedAt: last.completedAt,
            id: last.recordId,
          },
        })
      : null;
  return { records, hasMore, nextCursor };
}
