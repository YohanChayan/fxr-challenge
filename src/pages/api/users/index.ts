import type { APIRoute } from 'astro';
import { usersHandlers } from '../../../lib/server/users-handlers';

export const prerender = false;

/** List signups, newest first. Requires `Authorization: Bearer <ADMIN_API_TOKEN>`. */
export const GET: APIRoute = (context) => usersHandlers.list(context);

/**
 * Create an account from an email. Rate-limited per client IP; honours `Idempotency-Key`.
 * The full context is passed so the handler can read `clientAddress`.
 */
export const POST: APIRoute = (context) => usersHandlers.create(context);
