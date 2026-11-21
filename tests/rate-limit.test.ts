import { describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  clientIp,
  createRateLimiter,
} from '../src/lib/server/rate-limit';

describe('createRateLimiter', () => {
  it('defaults to 5 per 60 s', () => {
    expect(RATE_LIMIT_MAX).toBe(5);
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it('allows max hits per window, then reports the seconds left', () => {
    let now = 0;
    const limiter = createRateLimiter({ now: () => now });
    for (let i = 0; i < 5; i++) expect(limiter.hit('ip')).toEqual({ ok: true });
    now = 10_500;
    expect(limiter.hit('ip')).toEqual({ ok: false, retryAfterSeconds: 50 });
  });

  it('opens a fresh window once the old one has passed', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    expect(limiter.hit('ip').ok).toBe(true);
    now = 999;
    expect(limiter.hit('ip')).toEqual({ ok: false, retryAfterSeconds: 1 });
    now = 1_000;
    expect(limiter.hit('ip').ok).toBe(true);
  });

  it('keeps keys independent', () => {
    const limiter = createRateLimiter({ max: 1, now: () => 0 });
    expect(limiter.hit('a').ok).toBe(true);
    expect(limiter.hit('a').ok).toBe(false);
    expect(limiter.hit('b').ok).toBe(true);
  });

  it('never reports a Retry-After below 1 second', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    limiter.hit('ip');
    now = 999.9;
    expect(limiter.hit('ip')).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('still limits correctly after pruning a large map', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000, now: () => now });
    for (let i = 0; i <= 10_001; i++) limiter.hit(`ip-${i}`);
    now = 2_000; // every window above has expired and is pruned on this hit
    expect(limiter.hit('fresh').ok).toBe(true);
    expect(limiter.hit('fresh').ok).toBe(false);
    expect(limiter.hit('ip-0').ok).toBe(true);
  });
});

describe('clientIp', () => {
  const request = (xff?: string) =>
    new Request('http://localhost/api/users', {
      headers: xff === undefined ? {} : { 'X-Forwarded-For': xff },
    });

  it('uses the socket address when the proxy is not trusted', () => {
    expect(clientIp(request('1.1.1.1'), '10.0.0.2', false)).toBe('10.0.0.2');
  });

  it('uses the right-most X-Forwarded-For entry when the proxy is trusted', () => {
    expect(clientIp(request('1.1.1.1, 2.2.2.2 , 3.3.3.3'), '10.0.0.2', true)).toBe('3.3.3.3');
  });

  it('falls back to the socket address when a trusted proxy sends no usable header', () => {
    expect(clientIp(request(), '10.0.0.2', true)).toBe('10.0.0.2');
    expect(clientIp(request(' , '), '10.0.0.2', true)).toBe('10.0.0.2');
  });

  it("shares one 'unknown' bucket when no address is available", () => {
    expect(clientIp(request(), undefined, false)).toBe('unknown');
  });
});
