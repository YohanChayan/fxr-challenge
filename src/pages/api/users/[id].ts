import type { APIRoute } from 'astro';
import { usersHandlers } from '../../../lib/server/users-handlers';

export const prerender = false;

/** Set the preferred market from the success screen. */
export const PATCH: APIRoute = (context) => usersHandlers.update(context);
