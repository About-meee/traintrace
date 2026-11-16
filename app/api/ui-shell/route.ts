import { errorResponse, PRIVATE_JSON_HEADERS, requireDocumentSession } from "@/app/api/_shared";
// The Vinext Vite build inlines this template so it is only served after session authorization.
import trainingShell from "../../training-shell.html?raw";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireDocumentSession(request);
    return new Response(trainingShell, {
      headers: {
        ...PRIVATE_JSON_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
