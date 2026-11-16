import {
  createDocumentSession,
  errorResponse,
  PRIVATE_JSON_HEADERS,
  jsonResponse,
  requireDocumentSession,
  requireSiteIdentity,
  requireSameOriginMutation,
  revokeDocumentSession,
} from "@/app/api/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireDocumentSession(request);
    return new Response(null, { status: 204, headers: PRIVATE_JSON_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const identity = await requireSiteIdentity();
    const session = await createDocumentSession(identity.userId);
    return jsonResponse({
      token: session.token,
      ownerKey: identity.ownerKey,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const identity = await requireSiteIdentity();
    await revokeDocumentSession(request, identity.userId);
    return new Response(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
