// Browser fetch client for the Users API. Bundled into the signup island: no server imports.
// Responses are parsed with the same zod schemas the server uses, and every outcome is a typed
// value: this module never throws and holds no UI copy.
import { ErrorResponseSchema, UserResponseSchema, type Market } from '../schemas/user';
import type { CreateUserResult, UpdateMarketResult } from '../../types/signup';

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A positive number of seconds from `Retry-After`, or null. */
function retryAfterSeconds(res: Response): number | null {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * POST /api/users. `email` is expected to be validated by `EmailSchema` already. Send the same
 * `idempotencyKey` on a retry of the same email, so a lost 201 is replayed instead of a 409.
 */
export async function createUser(
  email: string,
  idempotencyKey?: string,
): Promise<CreateUserResult> {
  let res: Response;
  try {
    res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ email }),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }

  if (res.status === 201) {
    const body = UserResponseSchema.safeParse(await readJson(res));
    return body.success ? { ok: true, user: body.data.user } : { ok: false, kind: 'unexpected' };
  }

  const error = ErrorResponseSchema.safeParse(await readJson(res));
  const fieldMessage = error.success ? error.data.error.fields?.email : undefined;
  if ((res.status === 409 || res.status === 422) && fieldMessage) {
    return {
      ok: false,
      kind: 'field',
      code: res.status === 409 ? 'email_taken' : 'invalid_email',
      message: fieldMessage,
    };
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate_limited', retryAfterSeconds: retryAfterSeconds(res) };
  }
  return { ok: false, kind: 'unexpected' };
}

/** PATCH /api/users/:id with the only editable field. */
export async function updatePreferredMarket(
  id: string,
  market: Market,
): Promise<UpdateMarketResult> {
  let res: Response;
  try {
    res = await fetch(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredMarket: market }),
    });
  } catch {
    return { ok: false, kind: 'network' };
  }

  const body = res.ok ? UserResponseSchema.safeParse(await readJson(res)) : null;
  return body?.success ? { ok: true, user: body.data.user } : { ok: false, kind: 'unexpected' };
}
