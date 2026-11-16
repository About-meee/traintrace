import { and, eq, sql } from "drizzle-orm";
import {
  errorResponse,
  HttpError,
  isDocumentSessionActive,
  isPlainObject,
  jsonResponse,
  readJson,
  requireDocumentSession,
  requireSameOriginMutation,
} from "@/app/api/_shared";
import { getDb } from "@/db";
import { trainingRecords, userWorkspace } from "@/db/schema";

export const dynamic = "force-dynamic";

type Workspace = {
  revision: number;
  draft: unknown | null;
  customExercises: Array<Record<string, string | boolean>>;
  updatedAt: string | null;
};

function workspaceFromRow(row?: {
  revision: number;
  draftJson: string | null;
  customExercisesJson: string;
  updatedAt: string;
}): Workspace {
  return {
    revision: row?.revision ?? 0,
    draft: row?.draftJson ? JSON.parse(row.draftJson) : null,
    customExercises: row ? JSON.parse(row.customExercisesJson) : [],
    updatedAt: row?.updatedAt ?? null,
  };
}

async function readWorkspace(ownerUserId: string): Promise<Workspace> {
  const row = await getDb()
    .select()
    .from(userWorkspace)
    .where(eq(userWorkspace.ownerUserId, ownerUserId))
    .get();
  return workspaceFromRow(row);
}

async function readWorkspaceForRestore(ownerUserId: string): Promise<Workspace> {
  const workspace = await readWorkspace(ownerUserId);
  if (!isPlainObject(workspace.draft) || typeof workspace.draft.id !== "string") {
    return workspace;
  }

  const completedDraft = await getDb()
    .select({ recordId: trainingRecords.recordId })
    .from(trainingRecords)
    .where(
      and(
        eq(trainingRecords.ownerUserId, ownerUserId),
        eq(trainingRecords.recordId, workspace.draft.id),
      ),
    )
    .get();

  return completedDraft ? { ...workspace, draft: null } : workspace;
}

function validateDraft(value: unknown): string | null {
  if (value === null) return null;
  if (!isPlainObject(value)) throw new HttpError(400, "INVALID_ARGUMENT", "draft must be an object or null.");
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > 128 * 1024) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "draft is too large.");
  }
  return encoded;
}

function validateCustomExercises(value: unknown): string {
  if (!Array.isArray(value) || value.length > 500) {
    throw new HttpError(400, "INVALID_ARGUMENT", "customExercises must be an array of up to 500 items.");
  }
  const allowedParts = new Set(["chest", "back", "shoulders", "arms", "legs", "core", "cardio"]);
  const allowedTemplates = new Set(["weight", "body", "assisted", "time", "distance", "cardio"]);
  const ids = new Set<string>();
  const items = value.map((candidate, index) => {
    if (!isPlainObject(candidate)) {
      throw new HttpError(400, "INVALID_ARGUMENT", `customExercises[${index}] must be an object.`);
    }
    const keys = ["id", "part", "name", "en", "template", "icon", "custom"];
    if (Object.keys(candidate).some((key) => !keys.includes(key))) {
      throw new HttpError(400, "INVALID_ARGUMENT", `customExercises[${index}] contains an unsupported field.`);
    }
    const { id, part, name, en, template, icon, custom } = candidate;
    if (
      typeof id !== "string" ||
      !/^custom-[0-9a-f-]{36}$/i.test(id) ||
      ids.has(id)
    ) {
      throw new HttpError(400, "INVALID_ARGUMENT", `customExercises[${index}].id is invalid or duplicated.`);
    }
    ids.add(id);
    if (
      typeof part !== "string" ||
      !allowedParts.has(part) ||
      typeof name !== "string" ||
      name.trim() === "" ||
      name.length > 48 ||
      typeof template !== "string" ||
      !allowedTemplates.has(template) ||
      typeof en !== "string" ||
      en.length > 100 ||
      typeof icon !== "string" ||
      icon.length > 80 ||
      typeof custom !== "boolean"
    ) {
      throw new HttpError(400, "INVALID_ARGUMENT", `customExercises[${index}] has invalid fields.`);
    }
    return { id, part, name, en, template, icon, custom };
  });
  const encoded = JSON.stringify(items);
  if (new TextEncoder().encode(encoded).byteLength > 256 * 1024) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "customExercises are too large.");
  }
  return encoded;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireDocumentSession(request);
    return jsonResponse(await readWorkspaceForRestore(identity.userId));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const identity = await requireDocumentSession(request);
    const body = await readJson(request);
    if (
      !isPlainObject(body) ||
      Object.keys(body).some((key) => !["revision", "draft", "customExercises"].includes(key)) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 0 ||
      !Object.hasOwn(body, "draft") ||
      !Object.hasOwn(body, "customExercises")
    ) {
      throw new HttpError(400, "INVALID_ARGUMENT", "revision, draft, and customExercises are required.");
    }
    const draftJson = validateDraft(body.draft);
    const customExercisesJson = validateCustomExercises(body.customExercises);
    const db = getDb();
    const now = new Date().toISOString();
    const currentRevision = body.revision as number;

    const sessionHash = identity.sessionHash;
    const sessionCheckTime = Date.now();

    // Guard both workspace mutations in SQL so a request authorized before a
    // takeover cannot seed or update the workspace afterward.
    await db.run(sql`
      INSERT INTO user_workspace
        (owner_user_id, revision, draft_json, custom_exercises_json, updated_at)
      SELECT ${identity.userId}, 0, NULL, '[]', ${now}
      WHERE EXISTS (
        SELECT 1 FROM training_sessions
        WHERE session_hash = ${sessionHash}
          AND owner_user_id = ${identity.userId}
          AND expires_at > ${sessionCheckTime}
      )
      ON CONFLICT(owner_user_id) DO NOTHING
    `);

    const updated = await db.run(sql`
      UPDATE user_workspace
      SET revision = ${currentRevision + 1},
          draft_json = ${draftJson},
          custom_exercises_json = ${customExercisesJson},
          updated_at = ${now}
      WHERE owner_user_id = ${identity.userId}
        AND revision = ${currentRevision}
        AND EXISTS (
          SELECT 1 FROM training_sessions
          WHERE session_hash = ${sessionHash}
            AND owner_user_id = ${identity.userId}
            AND expires_at > ${sessionCheckTime}
        )
    `);

    if (updated.meta.changes === 0) {
      if (!(await isDocumentSessionActive(identity.userId, sessionHash))) {
        throw new HttpError(401, "SESSION_REPLACED", "This TRAINTRACE session was replaced or expired.");
      }
      const workspace = await readWorkspace(identity.userId);
      return jsonResponse(
        {
          error: "WORKSPACE_CONFLICT",
          message: "Workspace changed in another tab or device.",
          workspace,
        },
        409,
      );
    }
    return jsonResponse(await readWorkspace(identity.userId));
  } catch (error) {
    return errorResponse(error);
  }
}
