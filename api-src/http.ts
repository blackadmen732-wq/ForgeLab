import type { IncomingMessage, ServerResponse } from "node:http";

/** Small HTTP helpers shared by every ForgeLab function. */
export interface ApiRequest {
  readonly method: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export const MAX_BODY_BYTES = 4096;

export const fail = (status: number, error: string): ApiResponse => ({ status, body: { error } });

/** Extracts a bearer token; identity is always derived from it server-side, never from the body. */
export function bearer(authorization: string | undefined): string | null {
  const match = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/i.exec(authorization ?? "");
  return match === null ? null : match[1]!;
}

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES)
      throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be JSON."), { status: 400 });
  }
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(body));
}

/** Wraps a request → response core as a Node handler with uniform error handling. */
export function serve(core: (request: ApiRequest) => Promise<ApiResponse>) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("allow", "POST");
        res.end();
        return;
      }
      const body = req.method === "POST" ? await readJson(req) : null;
      const auth = req.headers.authorization;
      const response = await core({
        method: req.method ?? "GET",
        authorization: Array.isArray(auth) ? auth[0] : auth,
        body,
      });
      send(res, response.status, response.body);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      // Internal details stay in the function log.
      if (status === 500) console.error("api error:", error);
      send(res, status, {
        error:
          status === 500 ? "The server could not complete that request." : (error as Error).message,
      });
    }
  };
}
