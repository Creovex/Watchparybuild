// The request pipeline every function shares: CORS, method, JWT, input, then the function's work.

import type { z } from 'zod';
import type { Caller, VerifyJwt } from './clients.ts';
import { allowedOrigins, corsHeaders, preflight } from './cors.ts';
import type { Env } from './env.ts';
import { bearerToken, fail, respond, type FunctionResult } from './http.ts';

export interface Context<I> {
  caller: Caller;
  /** The caller's own JWT, for clients that must act as the caller. */
  jwt: string;
  input: I;
}

export interface HandlerSpec<I, O> {
  /** Used in log lines. */
  name: string;
  env: Env;
  verify: VerifyJwt;
  input: z.ZodType<I>;
  run(ctx: Context<I>): Promise<FunctionResult<O>>;
}

export type Handler = (req: Request) => Promise<Response>;

export function createHandler<I, O>(spec: HandlerSpec<I, O>): Handler {
  const allowed = allowedOrigins(spec.env);
  return async (req) => {
    if (req.method === 'OPTIONS') return preflight(req, allowed);
    const cors = corsHeaders(req.headers.get('Origin'), allowed);
    if (req.method !== 'POST') return respond(fail('invalid_input'), cors);

    const jwt = bearerToken(req);
    if (!jwt) return respond(fail('unauthorized'), cors);
    let caller: Caller | null;
    try {
      caller = await spec.verify(jwt);
    } catch (err) {
      console.error(`[${spec.name}] could not verify the JWT`, err);
      return respond(fail('internal'), cors);
    }
    if (!caller) return respond(fail('unauthorized'), cors);

    let raw: unknown;
    try {
      const text = await req.text();
      raw = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      return respond(fail('invalid_input'), cors);
    }
    const parsed = spec.input.safeParse(raw);
    if (!parsed.success) return respond(fail('invalid_input'), cors);

    try {
      return respond(await spec.run({ caller, jwt, input: parsed.data }), cors);
    } catch (err) {
      console.error(`[${spec.name}] failed`, err);
      return respond(fail('internal'), cors);
    }
  };
}
