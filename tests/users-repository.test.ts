import { beforeEach, describe, expect, it } from 'vitest';
import { CreateUserBodySchema } from '../src/lib/schemas/user';
import { openDatabase } from '../src/lib/server/db';
import {
  createUsersRepository,
  decodeCursor,
  encodeCursor,
  IDEMPOTENCY_TTL_MS,
} from '../src/lib/server/users-repository';
import type { UsersRepository } from '../src/types/users';

// A clock that advances 1s per call, so created_at is distinct and ordered.
function steppingClock(start = Date.parse('2026-01-01T00:00:00.000Z')) {
  let t = start;
  return () => new Date((t += 1000));
}

function createOk(repo: UsersRepository, email: string) {
  const result = repo.create({ email });
  if (!result.ok) throw new Error(`create failed: ${result.error}`);
  return result.user;
}

describe('users repository', () => {
  let repo: UsersRepository;

  beforeEach(() => {
    repo = createUsersRepository(openDatabase(':memory:'), { now: steppingClock() });
  });

  it('creates a user with nulls and ISO timestamps', () => {
    const user = createOk(repo, 'ann@example.com');
    expect(user).toMatchObject({
      email: 'ann@example.com',
      preferredMarket: null,
      createdAt: '2026-01-01T00:00:01.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(repo.findById(user.id)).toEqual(user);
  });

  it('reports replayed: false for a plain create', () => {
    expect(repo.create({ email: 'ann@example.com' })).toMatchObject({ ok: true, replayed: false });
  });

  it('returns email_taken on a duplicate email', () => {
    createOk(repo, 'ann@example.com');
    expect(repo.create({ email: 'ann@example.com' })).toEqual({ ok: false, error: 'email_taken' });
  });

  it.each(['ANN@example.com', '  ann@Example.COM  '])(
    'returns email_taken for the normalised variant %j',
    (variant) => {
      createOk(repo, 'ann@example.com');
      expect(repo.create(CreateUserBodySchema.parse({ email: variant }))).toEqual({
        ok: false,
        error: 'email_taken',
      });
    },
  );

  it('sets the preferred market and bumps updatedAt', () => {
    const user = createOk(repo, 'ann@example.com');

    const first = repo.update(user.id, { preferredMarket: 'indices' });
    expect(first).toMatchObject({ ok: true, user: { preferredMarket: 'indices' } });

    const second = repo.update(user.id, { preferredMarket: 'stocks' });
    expect(second).toMatchObject({ ok: true, user: { preferredMarket: 'stocks' } });
    if (!second.ok) throw new Error('unreachable');
    expect(second.user.createdAt).toBe(user.createdAt);
    expect(second.user.updatedAt > user.updatedAt).toBe(true);
    expect(repo.findById(user.id)?.preferredMarket).toBe('stocks');
  });

  it('returns not_found when updating a missing id', () => {
    expect(repo.update(crypto.randomUUID(), { preferredMarket: 'forex' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('returns null from findById for a missing id', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
  });

  it('lists newest first', () => {
    const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
    for (const email of emails) createOk(repo, email);
    const result = repo.list({ limit: 10 });
    expect(result).toMatchObject({ ok: true, nextCursor: null });
    if (!result.ok) throw new Error('unreachable');
    expect(result.users.map((u) => u.email)).toEqual([...emails].reverse());
  });

  it('paginates with a cursor and ends with nextCursor null', () => {
    const emails = Array.from({ length: 5 }, (_, i) => `user${i}@example.com`);
    for (const email of emails) createOk(repo, email);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = repo.list({ limit: 2, cursor });
      if (!result.ok) throw new Error('unexpected invalid cursor');
      seen.push(...result.users.map((u) => u.email));
      cursor = result.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual([...emails].reverse());
  });

  it('breaks created_at ties by id so no row is skipped or repeated', () => {
    const tied = createUsersRepository(openDatabase(':memory:'), {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const ids = Array.from({ length: 4 }, (_, i) => createOk(tied, `t${i}@example.com`).id);

    const first = tied.list({ limit: 2 });
    if (!first.ok || !first.nextCursor) throw new Error('expected a second page');
    const second = tied.list({ limit: 2, cursor: first.nextCursor });
    if (!second.ok) throw new Error('unreachable');

    expect([...first.users, ...second.users].map((u) => u.id)).toEqual([...ids].sort().reverse());
    expect(second.nextCursor).toBeNull();
  });

  it.each([
    'not-base64-!!',
    Buffer.from('garbage').toString('base64url'),
    Buffer.from(`2026-01-01T00:00:00.000Z|not-a-uuid`).toString('base64url'),
    Buffer.from(`2026-01-01T00:00:00.000Z|${crypto.randomUUID()}|x`).toString('base64url'),
  ])('rejects a malformed cursor %j', (cursor) => {
    expect(repo.list({ limit: 5, cursor })).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2026-01-01T00:00:00.000Z', id: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  describe('idempotent create', () => {
    it('replays the stored user for the same key and email, without a second row', () => {
      const first = repo.create({ email: 'ann@example.com' }, { idempotencyKey: 'k1' });
      const second = repo.create({ email: 'ann@example.com' }, { idempotencyKey: 'k1' });
      expect(first).toMatchObject({ ok: true, replayed: false });
      expect(second).toMatchObject({ ok: true, replayed: true });
      if (!first.ok || !second.ok) throw new Error('unreachable');
      expect(second.user).toEqual(first.user);
      const listed = repo.list({ limit: 10 });
      expect(listed.ok && listed.users).toHaveLength(1);
    });

    it('returns idempotency_key_reused for the same key with a different email', () => {
      createOk(repo, 'seed@example.com');
      repo.create({ email: 'ann@example.com' }, { idempotencyKey: 'k1' });
      expect(repo.create({ email: 'bob@example.com' }, { idempotencyKey: 'k1' })).toEqual({
        ok: false,
        error: 'idempotency_key_reused',
      });
    });

    it('does not store a key when the email is taken', () => {
      createOk(repo, 'ann@example.com');
      expect(repo.create({ email: 'ann@example.com' }, { idempotencyKey: 'k1' })).toEqual({
        ok: false,
        error: 'email_taken',
      });
      expect(repo.create({ email: 'bob@example.com' }, { idempotencyKey: 'k1' })).toMatchObject({
        ok: true,
        replayed: false,
      });
    });

    it('ignores and prunes keys older than 24 h', () => {
      let t = Date.parse('2026-01-01T00:00:00.000Z');
      const db = openDatabase(':memory:');
      const timed = createUsersRepository(db, { now: () => new Date(t) });
      const countKeys = () =>
        db.prepare<[], { n: number }>('SELECT count(*) AS n FROM idempotency_keys').get()?.n;

      timed.create({ email: 'ann@example.com' }, { idempotencyKey: 'old' });
      expect(countKeys()).toBe(1);

      t += IDEMPOTENCY_TTL_MS - 1;
      expect(timed.create({ email: 'ann@example.com' }, { idempotencyKey: 'old' })).toMatchObject({
        ok: true,
        replayed: true,
      });

      t += 2;
      // Expired: the key is gone, so the same email recomputes to a 409 instead of a replay.
      expect(timed.create({ email: 'ann@example.com' }, { idempotencyKey: 'old' })).toEqual({
        ok: false,
        error: 'email_taken',
      });
      expect(countKeys()).toBe(0);
    });
  });
});
