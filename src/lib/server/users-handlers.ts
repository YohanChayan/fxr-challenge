// Server-only. The Users API handlers: parse -> repository -> response.
// Dependencies are injected so tests can run them against an in-memory database.
import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CreateUserBodySchema,
  IdempotencyKeySchema,
  ListUsersQuerySchema,
  UpdateUserBodySchema,
  UserIdSchema,
  type ListUsersResponse,
  type UserResponse,
} from '../schemas/user';
import { errorResponse, internalError, json, readJsonBody, validationError } from './http';
import { clientIp, createRateLimiter, type RateLimiter } from './rate-limit';
import { getUsersRepository, type UsersRepository } from './users-repository';

export type UsersHandlerDeps = {
  getRepository: () => UsersRepository;
  /** ADMIN_API_TOKEN. Unset or empty disables the list endpoint. */
  getAdminToken: () => string | undefined;
  /** Limits POST /api/users per client IP. */
  rateLimiter: RateLimiter;
  /** TRUST_PROXY=1: take the client IP from the right-most X-Forwarded-For entry. */
  getTrustProxy: () => boolean;
};

/** The subset of Astro's APIContext the handlers use. */
export type HandlerContext = {
  request: Request;
  params: Record<string, string | undefined>;
  /** The socket peer's address. Astro's getter throws when it is unavailable. */
  clientAddress?: string;
};

/** Reads `context.clientAddress` without letting Astro's throwing getter escape. */
function socketAddress(context: HandlerContext): string | undefined {
  try {
    return context.clientAddress;
  } catch {
    return undefined;
  }
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time bearer check; the scheme name is case-insensitive (RFC 9110).
 * Hashing first gives equal-length buffers for timingSafeEqual.
 */
export function isAuthorized(header: string | null, token: string | undefined): boolean {
  if (!token) return false;
  const match = /^Bearer (.+)$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  return timingSafeEqual(sha256(match[1]), sha256(token));
}

export function createUsersHandlers({
  getRepository,
  getAdminToken,
  rateLimiter,
  getTrustProxy,
}: UsersHandlerDeps) {
  return {
    /** Order: rate limit (429), body (400/413), schema (422), Idempotency-Key (422), insert. */
    async create(context: HandlerContext): Promise<Response> {
      const { request } = context;
      const limited = rateLimiter.hit(clientIp(request, socketAddress(context), getTrustProxy()));
      if (!limited.ok) {
        return errorResponse(
          'rate_limited',
          'Too many signup attempts. Please wait a moment and try again.',
          undefined,
          { 'Retry-After': String(limited.retryAfterSeconds) },
        );
      }

      const body = await readJsonBody(request);
      if (!body.ok) return body.response;

      const parsed = CreateUserBodySchema.safeParse(body.value);
      if (!parsed.success) return validationError(parsed.error);

      const rawKey = request.headers.get('idempotency-key');
      let idempotencyKey: string | undefined;
      if (rawKey !== null) {
        const key = IdempotencyKeySchema.safeParse(rawKey);
        if (!key.success) {
          return errorResponse('validation_error', key.error.issues[0]?.message ?? 'Invalid key');
        }
        idempotencyKey = key.data;
      }

      try {
        const result = getRepository().create(parsed.data, { idempotencyKey });
        if (!result.ok) {
          if (result.error === 'idempotency_key_reused') {
            return errorResponse(
              'idempotency_key_reused',
              'This Idempotency-Key was already used with a different request body',
            );
          }
          return errorResponse('email_taken', 'An account with this email already exists', {
            email: 'An account with this email already exists',
          });
        }
        return json(
          201,
          { user: result.user } satisfies UserResponse,
          result.replayed ? { 'Idempotent-Replayed': 'true' } : {},
        );
      } catch (err) {
        return internalError('POST /api/users', err);
      }
    },

    async update({ request, params }: HandlerContext): Promise<Response> {
      // A malformed id is indistinguishable from an unknown one: do not reveal the format.
      const id = UserIdSchema.safeParse(params.id);
      if (!id.success) return errorResponse('not_found', 'User not found');

      const body = await readJsonBody(request);
      if (!body.ok) return body.response;

      const parsed = UpdateUserBodySchema.safeParse(body.value);
      if (!parsed.success) return validationError(parsed.error);

      try {
        const result = getRepository().update(id.data, parsed.data);
        if (!result.ok) return errorResponse('not_found', 'User not found');
        return json(200, { user: result.user } satisfies UserResponse);
      } catch (err) {
        // Route only: the user id is a capability and never goes into logs.
        return internalError('PATCH /api/users/:id', err);
      }
    },

    async list({ request }: HandlerContext): Promise<Response> {
      if (!isAuthorized(request.headers.get('authorization'), getAdminToken())) {
        return errorResponse('unauthorized', 'A valid admin token is required');
      }

      const search = new URL(request.url).searchParams;
      const parsed = ListUsersQuerySchema.safeParse({
        limit: search.get('limit') ?? undefined,
        cursor: search.get('cursor') ?? undefined,
      });
      if (!parsed.success) return validationError(parsed.error);

      try {
        const result = getRepository().list(parsed.data);
        if (!result.ok) {
          return errorResponse('validation_error', 'Invalid request', { cursor: 'Invalid cursor' });
        }
        return json(200, {
          users: result.users,
          nextCursor: result.nextCursor,
        } satisfies ListUsersResponse);
      } catch (err) {
        return internalError('GET /api/users', err);
      }
    },
  };
}

/** Production wiring: the process-wide repository and limiter; env read per request. */
export const usersHandlers = createUsersHandlers({
  getRepository: getUsersRepository,
  getAdminToken: () => process.env.ADMIN_API_TOKEN,
  rateLimiter: createRateLimiter(),
  getTrustProxy: () => process.env.TRUST_PROXY === '1',
});
