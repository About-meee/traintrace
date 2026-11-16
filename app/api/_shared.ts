import { and, eq, gt } from "drizzle-orm";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getDb } from "@/db";
import { trainingSessions } from "@/db/schema";

export const PRIVATE_JSON_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: PRIVATE_JSON_HEADERS,
  });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status);
  }
  console.error("TRAINTRACE request failed");
  return jsonResponse(
    { error: "INTERNAL_ERROR", message: "Request could not be completed." },
    500,
  );
}

export async function readJson(request: Request, maximumBytes = 512 * 1024): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maximumBytes) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "INVALID_ARGUMENT", "Request body must be valid JSON.");
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function requireSameOriginMutation(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, "FORBIDDEN", "Cross-origin requests are not allowed.");
    }
    if (parsed.origin !== new URL(request.url).origin) {
      throw new HttpError(403, "FORBIDDEN", "Cross-origin requests are not allowed.");
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "FORBIDDEN", "Cross-origin requests are not allowed.");
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type SiteIdentity = {
  userId: string;
  ownerKey: string;
};

export type DocumentSessionIdentity = SiteIdentity & {
  sessionHash: string;
};

export async function requireSiteIdentity(): Promise<SiteIdentity> {
  const user = await getChatGPTUser();
  if (!user?.userId) {
    throw new HttpError(401, "UNAUTHENTICATED", "Sign in with ChatGPT to continue.");
  }
  return {
    userId: user.userId,
    ownerKey: await sha256Hex(user.userId),
  };
}

export async function createDocumentSession(
  ownerUserId: string,
): Promise<{ token: string; expiresAt: string }> {
  const db = getDb();
  const now = Date.now();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  const expiresAt = now + 8 * 60 * 60 * 1000;
  const sessionHash = await sha256Hex(token);

  // D1 executes batch statements atomically. Deleting this owner's previous
  // session and inserting the replacement in one batch prevents overlapping
  // POSTs from leaving multiple active documents. Other owners are untouched.
  await db.batch([
    db.delete(trainingSessions).where(eq(trainingSessions.ownerUserId, ownerUserId)),
    db.insert(trainingSessions).values({
      sessionHash,
      ownerUserId,
      createdAt: now,
      expiresAt,
    }),
  ]);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export async function isDocumentSessionActive(ownerUserId: string, sessionHash: string): Promise<boolean> {
  const row = await getDb()
    .select({ sessionHash: trainingSessions.sessionHash })
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.sessionHash, sessionHash),
        eq(trainingSessions.ownerUserId, ownerUserId),
        gt(trainingSessions.expiresAt, Date.now()),
      ),
    )
    .get();
  return Boolean(row);
}

export async function requireDocumentSession(request: Request): Promise<DocumentSessionIdentity> {
  const identity = await requireSiteIdentity();
  const token = request.headers.get("x-traintrace-session");
  if (!token || token.length > 128) {
    throw new HttpError(401, "UNAUTHENTICATED", "Open a fresh TRAINTRACE session.");
  }
  const tokenHash = await sha256Hex(token);
  const session = await getDb()
    .select({
      ownerUserId: trainingSessions.ownerUserId,
      expiresAt: trainingSessions.expiresAt,
    })
    .from(trainingSessions)
    .where(eq(trainingSessions.sessionHash, tokenHash))
    .get();
  if (!session || session.ownerUserId !== identity.userId || session.expiresAt <= Date.now()) {
    if (session?.expiresAt && session.expiresAt <= Date.now()) {
      await getDb()
        .delete(trainingSessions)
        .where(
          and(
            eq(trainingSessions.sessionHash, tokenHash),
            eq(trainingSessions.ownerUserId, identity.userId),
          ),
        );
    }
    throw new HttpError(401, "SESSION_REPLACED", "This TRAINTRACE session was replaced or expired.");
  }
  return { ...identity, sessionHash: tokenHash };
}

export async function revokeDocumentSession(request: Request, ownerUserId: string): Promise<void> {
  const token = request.headers.get("x-traintrace-session");
  if (!token || token.length > 128) return;
  await getDb()
    .delete(trainingSessions)
    .where(
      and(
        eq(trainingSessions.sessionHash, await sha256Hex(token)),
        eq(trainingSessions.ownerUserId, ownerUserId),
      ),
    );
}
