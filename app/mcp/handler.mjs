import { TRAINING_RECORDS_TOOL } from "./tool-schema.mjs";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

const ERROR_MESSAGES = {
  UNAUTHENTICATED: "Sign in to read your training records.",
  INVALID_ARGUMENT: "The query arguments are invalid.",
  INVALID_CURSOR: "The page cursor is invalid for this query.",
  FORBIDDEN: "You are not allowed to read these training records.",
  INTERNAL_ERROR: "The training records could not be read.",
};

const RECORD_FIELDS = [
  "id",
  "part",
  "exerciseId",
  "name",
  "template",
  "date",
  "startedAt",
  "completedAt",
  "groups",
  "fatigue",
];

const GROUP_FIELDS = {
  weight: ["weight", "reps", "assistanceKg"],
  body: ["reps"],
  assisted: ["assistanceKg", "reps"],
  time: ["seconds"],
  distance: ["km"],
  cardio: ["seconds", "km"],
};

const REQUIRED_GROUP_FIELDS = {
  weight: ["weight", "reps"],
  body: ["reps"],
  assisted: ["assistanceKg", "reps"],
  time: ["seconds"],
  distance: ["km"],
  cardio: [],
};

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function rpcResult(id, result) {
  return response({ jsonrpc: "2.0", id, result });
}

function rpcError(id, code, message) {
  return response({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolError(code) {
  const safeCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : "INTERNAL_ERROR";
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({ code: safeCode, message: ERROR_MESSAGES[safeCode] }),
      },
    ],
  };
}

function getSafeErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  if (Object.hasOwn(ERROR_MESSAGES, code)) return code;
  if (error && typeof error === "object" && error.status === 401) return "UNAUTHENTICATED";
  if (error && typeof error === "object" && error.status === 403) return "FORBIDDEN";
  return "INTERNAL_ERROR";
}

function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateArguments(value) {
  if (!isPlainObject(value)) return { error: "INVALID_ARGUMENT" };

  const allowedKeys = new Set(["mode", "fromDate", "throughDate", "limit", "cursor"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return { error: "INVALID_ARGUMENT" };
  }

  if (value.mode === "date_range") {
    if (!isRealDate(value.fromDate) || !isRealDate(value.throughDate)) {
      return { error: "INVALID_ARGUMENT" };
    }
    if (value.throughDate < value.fromDate) return { error: "INVALID_ARGUMENT" };
  } else if (value.mode === "all") {
    if (Object.hasOwn(value, "fromDate") || Object.hasOwn(value, "throughDate")) {
      return { error: "INVALID_ARGUMENT" };
    }
  } else {
    return { error: "INVALID_ARGUMENT" };
  }

  if (
    Object.hasOwn(value, "limit") &&
    (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 20)
  ) {
    return { error: "INVALID_ARGUMENT" };
  }
  if (Object.hasOwn(value, "cursor")) {
    if (typeof value.cursor !== "string") return { error: "INVALID_ARGUMENT" };
    if (value.cursor.length === 0) return { error: "INVALID_CURSOR" };
  }

  const { mode, fromDate, throughDate, limit, cursor } = value;
  const query =
    mode === "date_range"
      ? { mode, fromDate, throughDate }
      : { mode };
  const options = {};
  if (Object.hasOwn(value, "limit")) options.limit = limit;
  if (Object.hasOwn(value, "cursor")) options.cursor = cursor;
  return { query, options };
}

function sanitizeRecord(value) {
  if (!isPlainObject(value)) throw new TypeError("Invalid record from the query service.");

  for (const field of ["id", "part", "exerciseId", "name", "date", "startedAt", "completedAt"]) {
    if (typeof value[field] !== "string") throw new TypeError("Invalid record from the query service.");
  }
  if (
    value.name.length > 200 ||
    !isRealDate(value.date) ||
    typeof value.template !== "string" ||
    !Object.hasOwn(GROUP_FIELDS, value.template) ||
    !Number.isSafeInteger(value.fatigue) ||
    value.fatigue < 0 ||
    !Array.isArray(value.groups) ||
    value.groups.length < 1 ||
    value.groups.length > 100
  ) {
    throw new TypeError("Invalid record from the query service.");
  }

  const output = {};
  for (const field of RECORD_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    if (field !== "groups") {
      output[field] = value[field];
      continue;
    }

    output.groups = value.groups.map((group) => {
      if (!isPlainObject(group)) throw new TypeError("Invalid training group from the query service.");
      if (REQUIRED_GROUP_FIELDS[value.template].some((key) => !Object.hasOwn(group, key))) {
        throw new TypeError("Invalid training group from the query service.");
      }
      if (
        value.template === "cardio" &&
        !Object.hasOwn(group, "seconds") &&
        !Object.hasOwn(group, "km")
      ) {
        throw new TypeError("Invalid training group from the query service.");
      }
      const sanitizedGroup = {};
      for (const key of GROUP_FIELDS[value.template]) {
        if (!Object.hasOwn(group, key)) continue;
        const number = group[key];
        if (
          typeof number !== "number" ||
          !Number.isFinite(number) ||
          (key === "reps"
            ? !Number.isSafeInteger(number) || number < 1
            : key === "weight" || key === "assistanceKg"
              ? number < 0
              : number <= 0)
        ) {
          throw new TypeError("Invalid training group from the query service.");
        }
        sanitizedGroup[key] = number;
      }
      return sanitizedGroup;
    });
  }
  return output;
}

function discoverResult() {
  return {
    supportedVersions: [MCP_PROTOCOL_VERSION],
    capabilities: { tools: {} },
  };
}

function isValidRequest(value) {
  if (!isPlainObject(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return false;
  }
  if (!Object.hasOwn(value, "id")) return true;
  return value.id === null || typeof value.id === "string" || typeof value.id === "number";
}

async function dispatch(request, dependencies) {
  if (request.method === "server/discover") {
    return { result: discoverResult() };
  }

  if (request.method === "tools/list") {
    return { result: { tools: [TRAINING_RECORDS_TOOL] } };
  }

  if (request.method === "tools/call") {
    const params = request.params;
    if (!isPlainObject(params) || typeof params.name !== "string") {
      return { error: { code: -32602, message: "Invalid params." } };
    }
    if (params.name !== TRAINING_RECORDS_TOOL.name) {
      return { result: toolError("INVALID_ARGUMENT") };
    }

    const validated = validateArguments(params.arguments ?? {});
    if (validated.error) return { result: toolError(validated.error) };

    try {
      const userIdentity = await dependencies.requireSiteIdentity(request.httpRequest);
      if (
        !isPlainObject(userIdentity) ||
        typeof userIdentity.userId !== "string" ||
        userIdentity.userId.length === 0
      ) {
        return { result: toolError("UNAUTHENTICATED") };
      }

      const page = await dependencies.listRecordsForUser(
        userIdentity.userId,
        validated.query,
        validated.options,
      );
      if (
        !isPlainObject(page) ||
        !Array.isArray(page.records) ||
        typeof page.hasMore !== "boolean" ||
        (page.hasMore
          ? typeof page.nextCursor !== "string" || page.nextCursor.length === 0
          : page.nextCursor !== null)
      ) {
        throw new TypeError("Invalid page from the query service.");
      }

      const payload = {
        schemaVersion: "1.0",
        mode: validated.query.mode,
        range:
          validated.query.mode === "date_range"
            ? {
                fromDate: validated.query.fromDate,
                throughDate: validated.query.throughDate,
              }
            : null,
        records: page.records.map(sanitizeRecord),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
      return {
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }],
        },
      };
    } catch (error) {
      return { result: toolError(getSafeErrorCode(error)) };
    }
  }

  return { error: { code: -32601, message: "Method not found." } };
}

/**
 * Create a stateless JSON-RPC endpoint for a Sites POST /mcp route.
 * requireSiteIdentity must read the trusted Sites request identity. It must not use tool arguments.
 * listRecordsForUser must apply the supplied user ID and call W01's shared query layer.
 */
export function createMcpHandler({ requireSiteIdentity, listRecordsForUser }) {
  if (typeof requireSiteIdentity !== "function" || typeof listRecordsForUser !== "function") {
    throw new TypeError("MCP handler dependencies must be functions.");
  }

  return async function handleMcpRequest(httpRequest) {
    if (httpRequest.method !== "POST") {
      return response({ error: "Method not allowed." }, 405);
    }

    let body;
    try {
      const rawBody = await httpRequest.text();
      if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) {
        return rpcError(null, -32700, "Request is too large.");
      }
      body = JSON.parse(rawBody);
    } catch {
      return rpcError(null, -32700, "Parse error.");
    }

    if (!isValidRequest(body)) {
      return rpcError(null, -32600, "Invalid Request.");
    }
    if (!Object.hasOwn(body, "id")) {
      return new Response(null, { status: 202 });
    }

    const outcome = await dispatch(
      { ...body, httpRequest },
      { requireSiteIdentity, listRecordsForUser },
    );
    if (outcome.error) return rpcError(body.id, outcome.error.code, outcome.error.message);
    return rpcResult(body.id, outcome.result);
  };
}

