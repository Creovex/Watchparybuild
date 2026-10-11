// Responses shared by every Edge Function: `{ ok: true, data }` or `{ ok: false, code }`.

/**
 * Every code an Edge Function returns, with its HTTP status. The same list is `FUNCTION_CODES` in
 * packages/sync-core/src/schemas.ts; a test keeps the two equal.
 */
export const FUNCTION_STATUS = {
  invalid_input: 400,
  unauthorized: 401,
  not_member: 403,
  not_host: 403,
  wrong_voice_mode: 403,
  voice_muted: 403,
  not_found: 404,
  rate_limited: 429,
  internal: 500,
  voice_sync_failed: 500,
} as const;

export type FunctionCode = keyof typeof FUNCTION_STATUS;

export type FunctionResult<T> = { ok: true; data: T } | { ok: false; code: FunctionCode };

export function isFunctionCode(value: unknown): value is FunctionCode {
  return typeof value === 'string' && Object.hasOwn(FUNCTION_STATUS, value);
}

export function fail(code: FunctionCode): { ok: false; code: FunctionCode } {
  return { ok: false, code };
}

export function respond<T>(result: FunctionResult<T>, headers: Record<string, string>): Response {
  const status = result.ok ? 200 : FUNCTION_STATUS[result.code];
  const body = result.ok ? { ok: true, data: result.data } : { ok: false, code: result.code };
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/** The bearer token from the Authorization header, or null. */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
