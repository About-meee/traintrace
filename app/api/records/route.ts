import {
  errorResponse,
  HttpError,
  jsonResponse,
  readJson,
  requireDocumentSession,
  requireSameOriginMutation,
} from "@/app/api/_shared";
import { listTrainingRecordsForUser, saveTrainingRecordForUser } from "@/app/api/_shared/records";

export const dynamic = "force-dynamic";

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const identity = await requireDocumentSession(request);
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const fromDate = url.searchParams.get("fromDate");
    const throughDate = url.searchParams.get("throughDate");
    if (date !== null && (fromDate !== null || throughDate !== null)) {
      throw new HttpError(400, "INVALID_ARGUMENT", "Use date or a date range, not both.");
    }

    let range: { fromDate: string; throughDate: string } | null = null;
    if (date !== null) {
      if (!validDate(date)) throw new HttpError(400, "INVALID_ARGUMENT", "date must be a real YYYY-MM-DD date.");
      range = { fromDate: date, throughDate: date };
    } else if (fromDate !== null || throughDate !== null) {
      if (!fromDate || !throughDate || !validDate(fromDate) || !validDate(throughDate) || throughDate < fromDate) {
        throw new HttpError(400, "INVALID_ARGUMENT", "fromDate and throughDate must form a valid inclusive date range.");
      }
      range = { fromDate, throughDate };
    }

    if (range) {
      const page = await listTrainingRecordsForUser(
        identity.userId,
        { mode: "date_range", ...range },
        { limit: 20 },
      );
      const records = [...page.records];
      let cursor = page.nextCursor;
      while (cursor) {
        const next = await listTrainingRecordsForUser(
          identity.userId,
          { mode: "date_range", ...range },
          { limit: 20, cursor },
        );
        records.push(...next.records);
        cursor = next.nextCursor;
      }
      return jsonResponse({ records });
    }

    const first = await listTrainingRecordsForUser(identity.userId, { mode: "all" }, { limit: 20 });
    const records = [...first.records];
    let cursor = first.nextCursor;
    while (cursor) {
      const next = await listTrainingRecordsForUser(
        identity.userId,
        { mode: "all" },
        { limit: 20, cursor },
      );
      records.push(...next.records);
      cursor = next.nextCursor;
    }
    return jsonResponse({ records });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOriginMutation(request);
    const identity = await requireDocumentSession(request);
    const record = await readJson(request, 256 * 1024);
    const result = await saveTrainingRecordForUser(identity.userId, identity.sessionHash, record);
    return jsonResponse(result, result.created ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}
