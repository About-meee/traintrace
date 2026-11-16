import { requireSiteIdentity } from "@/app/api/_shared";
import { listTrainingRecordsForUser } from "@/app/api/_shared/records";
import { createMcpHandler } from "./handler.mjs";

export const dynamic = "force-dynamic";

const handleMcpRequest = createMcpHandler({
  requireSiteIdentity: async () => requireSiteIdentity(),
  listRecordsForUser: listTrainingRecordsForUser,
});

export function POST(request: Request): Promise<Response> {
  return handleMcpRequest(request);
}
