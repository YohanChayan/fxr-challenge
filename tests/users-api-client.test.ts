import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser, updatePreferredMarket } from '../src/lib/api/users';

const USER = {
  id: '3f1c2a5e-8b7d-4c6a-9e2f-1a2b3c4d5e6f',
  email: 'trader@example.com',
  preferredMarket: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const errorBody = (code: string, fields?: Record<string, string>) => ({
  error: { code, message: 'x', ...(fields ? { fields } : {}) },
});

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createUser', () => {
  it('POSTs the email as JSON with the Idempotency-Key, and returns the user on 201', async () => {
    fetchMock.mockResolvedValue(respond(201, { user: USER }));
    await expect(createUser('trader@example.com', 'key-1')).resolves.toEqual({
      ok: true,
      user: USER,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/users');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-1',
    });
    expect(init?.body).toBe(JSON.stringify({ email: 'trader@example.com' }));
  });

  it('omits the Idempotency-Key header when there is no key', async () => {
    fetchMock.mockResolvedValue(respond(201, { user: USER }));
    await createUser('trader@example.com');
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('treats a 201 whose body breaks the contract as unexpected', async () => {
    fetchMock.mockResolvedValue(respond(201, { user: { id: 'nope' } }));
    await expect(createUser('a@example.com')).resolves.toEqual({ ok: false, kind: 'unexpected' });
  });

  it('turns a 409 with fields.email into a field error', async () => {
    fetchMock.mockResolvedValue(
      respond(
        409,
        errorBody('email_taken', { email: 'An account with this email already exists' }),
      ),
    );
    await expect(createUser('a@example.com')).resolves.toEqual({
      ok: false,
      kind: 'field',
      code: 'email_taken',
      message: 'An account with this email already exists',
    });
  });

  it('turns a 422 with fields.email into a field error', async () => {
    fetchMock.mockResolvedValue(
      respond(422, errorBody('validation_error', { email: 'Enter a valid email address' })),
    );
    await expect(createUser('a@example.com')).resolves.toEqual({
      ok: false,
      kind: 'field',
      code: 'invalid_email',
      message: 'Enter a valid email address',
    });
  });

  it('treats a 422 without fields.email (e.g. idempotency_key_reused) as unexpected', async () => {
    fetchMock.mockResolvedValue(respond(422, errorBody('idempotency_key_reused')));
    await expect(createUser('a@example.com')).resolves.toEqual({ ok: false, kind: 'unexpected' });
  });

  it('reads Retry-After on a 429', async () => {
    fetchMock.mockResolvedValue(respond(429, errorBody('rate_limited'), { 'Retry-After': '42' }));
    await expect(createUser('a@example.com')).resolves.toEqual({
      ok: false,
      kind: 'rate_limited',
      retryAfterSeconds: 42,
    });
  });

  it.each([[undefined], ['soon'], ['0'], ['-3']])(
    'returns retryAfterSeconds null for a 429 with Retry-After %s',
    async (header) => {
      fetchMock.mockResolvedValue(
        respond(
          429,
          errorBody('rate_limited'),
          header === undefined ? {} : { 'Retry-After': header },
        ),
      );
      await expect(createUser('a@example.com')).resolves.toEqual({
        ok: false,
        kind: 'rate_limited',
        retryAfterSeconds: null,
      });
    },
  );

  it('returns network when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createUser('a@example.com')).resolves.toEqual({ ok: false, kind: 'network' });
  });

  it('treats a 500 or a non-JSON body as unexpected', async () => {
    fetchMock.mockResolvedValueOnce(respond(500, errorBody('internal')));
    fetchMock.mockResolvedValueOnce(respond(502, '<html>Bad gateway</html>'));
    await expect(createUser('a@example.com')).resolves.toEqual({ ok: false, kind: 'unexpected' });
    await expect(createUser('a@example.com')).resolves.toEqual({ ok: false, kind: 'unexpected' });
  });
});

describe('updatePreferredMarket', () => {
  it('PATCHes the market to the encoded id and returns the user on 200', async () => {
    const updated = { ...USER, preferredMarket: 'crypto' };
    fetchMock.mockResolvedValue(respond(200, { user: updated }));
    await expect(updatePreferredMarket(USER.id, 'crypto')).resolves.toEqual({
      ok: true,
      user: updated,
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/users/${USER.id}`);
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ preferredMarket: 'crypto' }));
  });

  it('encodes the id into the path', async () => {
    fetchMock.mockResolvedValue(respond(404, errorBody('not_found')));
    await updatePreferredMarket('a/b?c', 'forex');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/users/a%2Fb%3Fc');
  });

  it('returns unexpected for a 404, a 422 or a bad 200 body', async () => {
    fetchMock.mockResolvedValueOnce(respond(404, errorBody('not_found')));
    fetchMock.mockResolvedValueOnce(respond(422, errorBody('validation_error')));
    fetchMock.mockResolvedValueOnce(respond(200, { nope: true }));
    for (let i = 0; i < 3; i++) {
      await expect(updatePreferredMarket(USER.id, 'forex')).resolves.toEqual({
        ok: false,
        kind: 'unexpected',
      });
    }
  });

  it('returns network when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(updatePreferredMarket(USER.id, 'forex')).resolves.toEqual({
      ok: false,
      kind: 'network',
    });
  });
});
