import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ErrorResponseSchema,
  ListUsersResponseSchema,
  UserResponseSchema,
} from '../src/lib/schemas/user';
import { openDatabase } from '../src/lib/server/db';
import { MAX_BODY_BYTES } from '../src/lib/server/http';
import { createRateLimiter } from '../src/lib/server/rate-limit';
import { createUsersHandlers, isAuthorized } from '../src/lib/server/users-handlers';
import { createUsersRepository } from '../src/lib/server/users-repository';
import type { UsersRepository } from '../src/types/users';

const TOKEN = 'test-admin-token';
const BASE = 'http://localhost/api/users';

let repo: UsersRepository;
let adminToken: string | undefined;
let handlers: ReturnType<typeof createUsersHandlers>;

beforeEach(() => {
  let t = Date.parse('2026-01-01T00:00:00.000Z');
  repo = createUsersRepository(openDatabase(':memory:'), { now: () => new Date((t += 1000)) });
  adminToken = TOKEN;
  handlers = createUsersHandlers({
    getRepository: () => repo,
    getAdminToken: () => adminToken,
    // Generous here; the rate-limit suite below uses the real limits.
    rateLimiter: createRateLimiter({ max: 1_000 }),
    getTrustProxy: () => false,
  });
});

const jsonRequest = (
  method: string,
  body: unknown,
  url = BASE,
  headers: Record<string, string> = {},
) =>
  new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

type PostOptions = { headers?: Record<string, string>; clientAddress?: string };

const post = (body: unknown, { headers, clientAddress = '203.0.113.1' }: PostOptions = {}) =>
  handlers.create({ request: jsonRequest('POST', body, BASE, headers), params: {}, clientAddress });

const patch = (id: string, body: unknown) =>
  handlers.update({ request: jsonRequest('PATCH', body, `${BASE}/${id}`), params: { id } });

const list = (query = '', authorization: string | null = `Bearer ${TOKEN}`) =>
  handlers.list({
    request: new Request(`${BASE}${query}`, {
      headers: authorization ? { Authorization: authorization } : {},
    }),
    params: {},
  });

/** Asserts the status and the error envelope, and returns the error. */
async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toMatch(/^application\/json/);
  const body = ErrorResponseSchema.strict().parse(await res.json());
  expect(body.error.code).toBe(code);
  expect(body.error.message).not.toMatch(/sqlite|select|insert|at .*:\d+/i);
  return body.error;
}

async function createUser(email = 'ann@example.com') {
  const res = await post({ email });
  return UserResponseSchema.parse(await res.json()).user;
}

describe('POST /api/users', () => {
  it('201 with the created user, email normalised', async () => {
    const res = await post({ email: '  Ann@Example.com ' });
    expect(res.status).toBe(201);
    const { user } = UserResponseSchema.strict().parse(await res.json());
    expect(user).toMatchObject({ email: 'ann@example.com', preferredMarket: null });
    expect(res.headers.get('idempotent-replayed')).toBeNull();
  });

  it('422 for an invalid email, with a field message', async () => {
    const error = await expectError(await post({ email: 'nope' }), 422, 'validation_error');
    expect(error.fields).toEqual({ email: 'Enter a valid email address' });
  });

  it.each(['{not json', ''])('400 bad_request for unparseable body %j', async (raw) => {
    await expectError(await post(raw), 400, 'bad_request');
  });

  it.each(['null', '"a string"', '[]', '{}'])(
    '422 for valid JSON of the wrong shape %j',
    async (raw) => {
      await expectError(await post(raw), 422, 'validation_error');
    },
  );

  it('422 for an unknown key, naming it', async () => {
    const error = await expectError(
      await post({ email: 'ann@example.com', role: 'admin' }),
      422,
      'validation_error',
    );
    expect(error.fields).toEqual({ role: 'Unrecognized field' });
  });

  it('409 when the email is taken, including case and whitespace variants', async () => {
    await createUser('ann@example.com');
    const error = await expectError(await post({ email: ' ANN@example.COM' }), 409, 'email_taken');
    expect(error.fields).toHaveProperty('email');
  });

  it('500 with a generic message when the repository throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    repo = {
      ...repo,
      create: () => {
        throw new Error('SQLITE_IOERR: disk I/O error in INSERT INTO users');
      },
    };
    const error = await expectError(await post({ email: 'ann@example.com' }), 500, 'internal');
    expect(error.message).toBe('Something went wrong. Please try again.');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('PATCH /api/users/:id', () => {
  it('200 with the updated user', async () => {
    const user = await createUser();
    const res = await patch(user.id, { preferredMarket: 'crypto' });
    expect(res.status).toBe(200);
    const body = UserResponseSchema.strict().parse(await res.json());
    expect(body.user).toMatchObject({ id: user.id, preferredMarket: 'crypto' });
  });

  it('200 changing the market again', async () => {
    const user = await createUser();
    await patch(user.id, { preferredMarket: 'forex' });
    const body = UserResponseSchema.parse(
      await (await patch(user.id, { preferredMarket: 'futures' })).json(),
    );
    expect(body.user.preferredMarket).toBe('futures');
  });

  it('500 with a generic message, and the id never reaches the log', async () => {
    const user = await createUser();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    repo = {
      ...repo,
      update: () => {
        throw new Error('SQLITE_BUSY: database is locked');
      },
    };
    const error = await expectError(
      await patch(user.id, { preferredMarket: 'forex' }),
      500,
      'internal',
    );
    expect(error.message).toBe('Something went wrong. Please try again.');
    expect(spy).toHaveBeenCalledOnce();
    const logged = spy.mock.calls
      .flat()
      .map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack ?? ''}` : String(arg)))
      .join(' ');
    expect(logged).not.toContain(user.id);
    spy.mockRestore();
  });

  it('422 for an empty body', async () => {
    const user = await createUser();
    const error = await expectError(await patch(user.id, {}), 422, 'validation_error');
    expect(error.fields).toHaveProperty('preferredMarket');
  });

  it.each(['commodities', 'FOREX', '', null, 3])('422 for market %j', async (preferredMarket) => {
    const user = await createUser();
    const error = await expectError(
      await patch(user.id, { preferredMarket }),
      422,
      'validation_error',
    );
    expect(error.fields).toEqual({ preferredMarket: 'Choose one of the listed markets' });
  });

  it.each([
    [{ preferredMarket: 'forex', name: 'Ann' }, { name: 'Unrecognized field' }],
    [
      { preferredMarket: 'forex', experienceLevel: 'advanced' },
      { experienceLevel: 'Unrecognized field' },
    ],
    [{ preferredMarket: 'forex', email: 'other@example.com' }, { email: 'Unrecognized field' }],
  ])('422 for unknown key in %j', async (body, fields) => {
    const user = await createUser();
    const error = await expectError(await patch(user.id, body), 422, 'validation_error');
    expect(error.fields).toEqual(fields);
  });

  it('400 bad_request for a non-JSON body', async () => {
    const user = await createUser();
    await expectError(await patch(user.id, '{'), 400, 'bad_request');
  });

  it('404 for an unknown id', async () => {
    await expectError(
      await patch(crypto.randomUUID(), { preferredMarket: 'forex' }),
      404,
      'not_found',
    );
  });

  it('404, not 400, for a malformed id', async () => {
    await expectError(await patch('not-a-uuid', { preferredMarket: 'forex' }), 404, 'not_found');
  });
});

describe('GET /api/users', () => {
  it('200 newest first with the admin token', async () => {
    await createUser('a@example.com');
    await createUser('b@example.com');
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = ListUsersResponseSchema.strict().parse(await res.json());
    expect(body.users.map((u) => u.email)).toEqual(['b@example.com', 'a@example.com']);
    expect(body.nextCursor).toBeNull();
  });

  it('pages with limit and cursor', async () => {
    for (const e of ['a', 'b', 'c']) await createUser(`${e}@example.com`);
    const first = ListUsersResponseSchema.parse(await (await list('?limit=2')).json());
    expect(first.users.map((u) => u.email)).toEqual(['c@example.com', 'b@example.com']);
    expect(first.nextCursor).not.toBeNull();

    const query = `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`;
    const second = ListUsersResponseSchema.parse(await (await list(query)).json());
    expect(second.users.map((u) => u.email)).toEqual(['a@example.com']);
    expect(second.nextCursor).toBeNull();
  });

  it('401 without a token', async () => {
    const res = await list('', null);
    await expectError(res, 401, 'unauthorized');
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
  });

  it.each(['Bearer wrong', `Bearer ${TOKEN}x`, TOKEN, `Basic ${TOKEN}`, 'Bearer '])(
    '401 with authorization %j',
    async (header) => {
      await expectError(await list('', header), 401, 'unauthorized');
    },
  );

  it('401 when ADMIN_API_TOKEN is unset, even with a bearer header', async () => {
    adminToken = undefined;
    await expectError(await list('', 'Bearer undefined'), 401, 'unauthorized');
    adminToken = '';
    await expectError(await list('', 'Bearer '), 401, 'unauthorized');
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc'])('422 for %s', async (query) => {
    const error = await expectError(await list(query), 422, 'validation_error');
    expect(error.fields).toHaveProperty('limit');
  });

  it('422 for a malformed cursor', async () => {
    const error = await expectError(await list('?cursor=bogus'), 422, 'validation_error');
    expect(error.fields).toEqual({ cursor: 'Invalid cursor' });
  });

  it('500 with a generic message when the repository throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    repo = {
      ...repo,
      list: () => {
        throw new Error('SQLITE_CORRUPT: database disk image is malformed');
      },
    };
    const error = await expectError(await list(), 500, 'internal');
    expect(error.message).toBe('Something went wrong. Please try again.');
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it('checks auth before validating the query', async () => {
    await expectError(await list('?limit=0', null), 401, 'unauthorized');
  });
});

describe('POST /api/users idempotency', () => {
  const countUsers = () => {
    const result = repo.list({ limit: 100 });
    if (!result.ok) throw new Error('unreachable');
    return result.users.length;
  };

  it('replays the same 201 body for the same key and body, creating one row', async () => {
    const headers = { 'Idempotency-Key': crypto.randomUUID() };
    const first = await post({ email: 'ann@example.com' }, { headers });
    const second = await post({ email: ' ANN@example.com ' }, { headers });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(await second.json()).toEqual(await first.json());
    expect(countUsers()).toBe(1);
  });

  it('422 idempotency_key_reused for the same key with a different email', async () => {
    const headers = { 'Idempotency-Key': 'key-1' };
    expect((await post({ email: 'ann@example.com' }, { headers })).status).toBe(201);
    await expectError(
      await post({ email: 'bob@example.com' }, { headers }),
      422,
      'idempotency_key_reused',
    );
    expect(countUsers()).toBe(1);
  });

  it.each(['', 'a'.repeat(256), 'tab\tinside'])('422 for a malformed key %j', async (key) => {
    await expectError(
      await post({ email: 'ann@example.com' }, { headers: { 'Idempotency-Key': key } }),
      422,
      'validation_error',
    );
    expect(countUsers()).toBe(0);
  });

  it('without a key, a repeat is a 409 as before', async () => {
    expect((await post({ email: 'ann@example.com' })).status).toBe(201);
    await expectError(await post({ email: 'ann@example.com' }), 409, 'email_taken');
  });

  it('a new key for an email that is taken is a 409, and is not stored', async () => {
    await createUser('ann@example.com');
    const headers = { 'Idempotency-Key': 'key-2' };
    await expectError(await post({ email: 'ann@example.com' }, { headers }), 409, 'email_taken');
    // The key was not stored, so it is free for a different body.
    expect((await post({ email: 'bob@example.com' }, { headers })).status).toBe(201);
  });
});

describe('POST /api/users rate limit', () => {
  let clock: number;

  beforeEach(() => {
    clock = Date.parse('2026-01-01T00:00:00.000Z');
    handlers = createUsersHandlers({
      getRepository: () => repo,
      getAdminToken: () => adminToken,
      rateLimiter: createRateLimiter({ now: () => clock }),
      getTrustProxy: () => false,
    });
  });

  it('429 with Retry-After on the 6th POST from one IP in a minute, then allows again', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post({ email: `u${i}@example.com` })).status).toBe(201);
    }
    clock += 15_000;
    const limited = await post({ email: 'u5@example.com' });
    const error = await expectError(limited, 429, 'rate_limited');
    expect(error.message).not.toContain('u5@example.com');
    expect(limited.headers.get('retry-after')).toBe('45');

    clock += 45_000;
    expect((await post({ email: 'u5@example.com' })).status).toBe(201);
  });

  it('counts invalid attempts too, and limits before reading the body', async () => {
    for (let i = 0; i < 5; i++) await post('{not json');
    await expectError(await post('{not json'), 429, 'rate_limited');
  });

  it('counts two IPs independently', async () => {
    for (let i = 0; i < 5; i++)
      await post({ email: `a${i}@example.com` }, { clientAddress: '198.51.100.1' });
    await expectError(
      await post({ email: 'a5@example.com' }, { clientAddress: '198.51.100.1' }),
      429,
      'rate_limited',
    );
    const other = await post({ email: 'b@example.com' }, { clientAddress: '198.51.100.2' });
    expect(other.status).toBe(201);
  });

  it('ignores X-Forwarded-For unless TRUST_PROXY is on', async () => {
    for (let i = 0; i < 5; i++) {
      await post(
        { email: `x${i}@example.com` },
        { clientAddress: '10.0.0.2', headers: { 'X-Forwarded-For': `192.0.2.${i}` } },
      );
    }
    await expectError(
      await post(
        { email: 'x5@example.com' },
        { clientAddress: '10.0.0.2', headers: { 'X-Forwarded-For': '192.0.2.99' } },
      ),
      429,
      'rate_limited',
    );
  });

  it('with TRUST_PROXY, keys on the right-most X-Forwarded-For entry', async () => {
    handlers = createUsersHandlers({
      getRepository: () => repo,
      getAdminToken: () => adminToken,
      rateLimiter: createRateLimiter({ now: () => clock }),
      getTrustProxy: () => true,
    });
    const viaProxy = (email: string, xff: string) =>
      post({ email }, { clientAddress: '10.0.0.2', headers: { 'X-Forwarded-For': xff } });

    // A client spoofing the left-most entry is still counted on what the proxy appended.
    for (let i = 0; i < 5; i++) await viaProxy(`s${i}@example.com`, `1.1.1.${i}, 192.0.2.7`);
    await expectError(await viaProxy('s5@example.com', '9.9.9.9, 192.0.2.7'), 429, 'rate_limited');
    expect((await viaProxy('t@example.com', '192.0.2.8')).status).toBe(201);
  });
});

describe('isAuthorized', () => {
  it('needs a configured token and an exact bearer match', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(isAuthorized(null, TOKEN)).toBe(false);
  });

  it('treats the scheme name case-insensitively, but not the token', () => {
    expect(isAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`BEARER ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`Bearer ${TOKEN.toUpperCase()}`, TOKEN)).toBe(false);
  });
});

describe('request body size cap', () => {
  const oversized = JSON.stringify({ email: `${'a'.repeat(MAX_BODY_BYTES)}@example.com` });

  it('413 when Content-Length declares more than the cap, before reading', async () => {
    const request = new Request(BASE, {
      method: 'POST',
      headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
      body: '{}',
    });
    await expectError(await handlers.create({ request, params: {} }), 413, 'payload_too_large');
  });

  it('413 for an oversized streamed body with no Content-Length', async () => {
    const bytes = new TextEncoder().encode(oversized);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 1024) controller.enqueue(bytes.slice(i, i + 1024));
        controller.close();
      },
    });
    const request = new Request(BASE, { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    await expectError(await handlers.create({ request, params: {} }), 413, 'payload_too_large');
  });

  it("413 when the node adapter's own limit trips while reading", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('Body size limit exceeded: received more than 16384 bytes'));
      },
    });
    const request = new Request(BASE, { method: 'POST', body, duplex: 'half' } as RequestInit);
    await expectError(await handlers.create({ request, params: {} }), 413, 'payload_too_large');
  });

  it('413 on PATCH too', async () => {
    const user = await createUser();
    await expectError(await patch(user.id, oversized), 413, 'payload_too_large');
  });

  it('accepts a body exactly at the cap', async () => {
    const padding = MAX_BODY_BYTES - JSON.stringify({ email: 'ann@example.com' }).length;
    const raw = JSON.stringify({ email: 'ann@example.com' }) + ' '.repeat(padding);
    expect(new TextEncoder().encode(raw).length).toBe(MAX_BODY_BYTES);
    expect((await post(raw)).status).toBe(201);
  });
});
