// Server-only contract types for src/lib/server/rate-limit.ts. Type-only: no runtime code.

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export type RateLimiter = { hit(key: string): RateLimitResult };

export type RateLimiterOptions = {
  max?: number;
  windowMs?: number;
  /** Milliseconds since the epoch; injectable so tests control time. */
  now?: () => number;
};
