// Server-only. A fixed-window rate limiter for POST /api/users, keyed by client IP.
//
// SINGLE NODE ONLY. State lives in this process's memory: it resets on restart and is not
// shared between replicas. That matches the one-replica deployment (docs/DECISIONS.md);
// scaling out needs a shared store first.
import type { RateLimiter, RateLimiterOptions } from '../../types/rate-limit';

export const RATE_LIMIT_MAX = 5;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Above this many tracked IPs, expired windows are dropped on the next hit. */
const PRUNE_THRESHOLD = 10_000;

type Window = { start: number; count: number };

export function createRateLimiter({
  max = RATE_LIMIT_MAX,
  windowMs = RATE_LIMIT_WINDOW_MS,
  now = Date.now,
}: RateLimiterOptions = {}): RateLimiter {
  const windows = new Map<string, Window>();

  const prune = (at: number) => {
    for (const [key, window] of windows) {
      if (at - window.start >= windowMs) windows.delete(key);
    }
  };

  return {
    hit(key) {
      const at = now();
      if (windows.size > PRUNE_THRESHOLD) prune(at);

      const current = windows.get(key);
      if (!current || at - current.start >= windowMs) {
        windows.set(key, { start: at, count: 1 });
        return { ok: true };
      }
      if (current.count < max) {
        current.count += 1;
        return { ok: true };
      }
      const retryAfterSeconds = Math.max(1, Math.ceil((current.start + windowMs - at) / 1000));
      return { ok: false, retryAfterSeconds };
    },
  };
}

/**
 * The client IP to rate-limit on.
 *
 * Astro 7's node adapter sets `clientAddress` to the socket peer unless `security.allowedDomains`
 * is configured (it is not), and even then it takes the LEFT-most X-Forwarded-For entry, which
 * the client controls. Behind Caddy the socket peer is Caddy itself, so every visitor would
 * share one bucket. With `trustProxy` (TRUST_PROXY=1) the RIGHT-most X-Forwarded-For entry is
 * used instead: the one appended by the proxy directly in front of us, which a client cannot
 * forge. Only enable it when a proxy is actually in front; otherwise the header is spoofable.
 */
export function clientIp(
  request: Request,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    const last = forwarded
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    if (last) return last;
  }
  return socketAddress || 'unknown';
}
