// Server-only contract types for the Users API handlers and src/lib/server/http.ts.
// Type-only: no runtime code.
import type { RateLimiter } from './rate-limit';
import type { UsersRepository } from './users';

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

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };
