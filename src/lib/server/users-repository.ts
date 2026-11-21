// Server-only. The only module that contains SQL.
import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  UserResponseSchema,
  type CreateUserInput,
  type Market,
  type UpdateUserInput,
  type User,
  type UserResponse,
} from '../schemas/user';
import { getDb } from './db';

type UserRow = {
  id: string;
  email: string;
  preferred_market: Market | null;
  created_at: string;
  updated_at: string;
};

const COLUMNS = 'id, email, preferred_market, created_at, updated_at';

const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  preferredMarket: row.preferred_market,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// --- Cursor: opaque to clients, base64url of "<created_at>|<id>" of the last row returned.

type Cursor = { createdAt: string; id: string };
const CursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor | null {
  const [createdAt, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  if (rest.length > 0) return null;
  const parsed = CursorSchema.safeParse({ createdAt, id });
  return parsed.success ? parsed.data : null;
}

// --- Idempotency: a stored 201 is replayed for 24 h to a retry with the same key and body.

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** The request fingerprint: the normalised email is the whole POST body. */
const requestHash = (input: CreateUserInput) =>
  createHash('sha256').update(input.email, 'utf8').digest('hex');

type IdempotencyRow = { request_hash: string; response_body: string };

// --- Results: expected failures are values, not exceptions.

export type CreateResult =
  | { ok: true; user: User; replayed: boolean }
  | { ok: false; error: 'email_taken' | 'idempotency_key_reused' };
export type UpdateResult = { ok: true; user: User } | { ok: false; error: 'not_found' };
export type ListResult =
  { ok: true; users: User[]; nextCursor: string | null } | { ok: false; error: 'invalid_cursor' };

export type CreateOptions = {
  /** Validated `Idempotency-Key` header, if the client sent one. */
  idempotencyKey?: string;
};

export type UsersRepository = {
  create(input: CreateUserInput, options?: CreateOptions): CreateResult;
  update(id: string, input: UpdateUserInput): UpdateResult;
  findById(id: string): User | null;
  list(options: { limit: number; cursor?: string }): ListResult;
};

export type RepositoryOptions = {
  /** Clock for created_at/updated_at and key expiry; injectable so tests are deterministic. */
  now?: () => Date;
};

export function createUsersRepository(
  db: Database.Database,
  { now = () => new Date() }: RepositoryOptions = {},
): UsersRepository {
  const insert = db.prepare<[UserRow], UserRow>(
    `INSERT INTO users (${COLUMNS})
     VALUES (@id, @email, @preferred_market, @created_at, @updated_at)
     RETURNING ${COLUMNS}`,
  );

  const update = db.prepare<
    [{ id: string; preferred_market: Market; updated_at: string }],
    UserRow
  >(
    `UPDATE users SET preferred_market = @preferred_market, updated_at = @updated_at
     WHERE id = @id
     RETURNING ${COLUMNS}`,
  );

  const findById = db.prepare<[string], UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = ?`);

  const firstPage = db.prepare<[number], UserRow>(
    `SELECT ${COLUMNS} FROM users ORDER BY created_at DESC, id DESC LIMIT ?`,
  );

  const nextPage = db.prepare<[string, string, number], UserRow>(
    `SELECT ${COLUMNS} FROM users
     WHERE (created_at, id) < (?, ?)
     ORDER BY created_at DESC, id DESC LIMIT ?`,
  );

  const pruneKeys = db.prepare<[string]>(`DELETE FROM idempotency_keys WHERE created_at < ?`);

  const findKey = db.prepare<[string, string], IdempotencyRow>(
    `SELECT request_hash, response_body FROM idempotency_keys WHERE key = ? AND created_at >= ?`,
  );

  const storeKey = db.prepare<
    [{ key: string; request_hash: string; response_body: string; created_at: string }]
  >(
    `INSERT INTO idempotency_keys (key, request_hash, response_body, created_at)
     VALUES (@key, @request_hash, @response_body, @created_at)`,
  );

  /** Inserts the user; the UNIQUE index is the duplicate check, a SELECT beforehand would race. */
  const insertUser = (email: string, timestamp: string): User | null => {
    try {
      const row = insert.get({
        id: randomUUID(),
        email,
        preferred_market: null,
        created_at: timestamp,
        updated_at: timestamp,
      });
      // RETURNING always yields the inserted row.
      return toUser(row as UserRow);
    } catch (err) {
      if (err instanceof Database.SqliteError && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return null;
      }
      throw err;
    }
  };

  // Lookup, insert and key write commit together, so a key never points at a missing user
  // and a user created under a key always has the key stored.
  const createTx = db.transaction(
    (input: CreateUserInput, idempotencyKey: string | undefined): CreateResult => {
      const date = now();
      const timestamp = date.toISOString();

      if (idempotencyKey === undefined) {
        const user = insertUser(input.email, timestamp);
        return user ? { ok: true, user, replayed: false } : { ok: false, error: 'email_taken' };
      }

      const cutoff = new Date(date.getTime() - IDEMPOTENCY_TTL_MS).toISOString();
      pruneKeys.run(cutoff);

      const hash = requestHash(input);
      const stored = findKey.get(idempotencyKey, cutoff);
      if (stored) {
        if (stored.request_hash !== hash) return { ok: false, error: 'idempotency_key_reused' };
        const { user } = UserResponseSchema.parse(JSON.parse(stored.response_body));
        return { ok: true, user, replayed: true };
      }

      const user = insertUser(input.email, timestamp);
      // Only 201 outcomes are stored: a retry after a 409 recomputes to 409 anyway.
      if (!user) return { ok: false, error: 'email_taken' };
      storeKey.run({
        key: idempotencyKey,
        request_hash: hash,
        response_body: JSON.stringify({ user } satisfies UserResponse),
        created_at: timestamp,
      });
      return { ok: true, user, replayed: false };
    },
  );

  return {
    create(input, { idempotencyKey } = {}) {
      return createTx.immediate(input, idempotencyKey);
    },

    update(id, { preferredMarket }) {
      const row = update.get({
        id,
        preferred_market: preferredMarket,
        updated_at: now().toISOString(),
      });
      return row ? { ok: true, user: toUser(row) } : { ok: false, error: 'not_found' };
    },

    findById(id) {
      const row = findById.get(id);
      return row ? toUser(row) : null;
    },

    list({ limit, cursor }) {
      let rows: UserRow[];
      if (cursor === undefined) {
        rows = firstPage.all(limit + 1);
      } else {
        const after = decodeCursor(cursor);
        if (!after) return { ok: false, error: 'invalid_cursor' };
        rows = nextPage.all(after.createdAt, after.id, limit + 1);
      }

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.created_at, id: last.id })
          : null;
      return { ok: true, users: page.map(toUser), nextCursor };
    },
  };
}

let instance: UsersRepository | undefined;

/** The process-wide repository over the process-wide database. */
export function getUsersRepository(): UsersRepository {
  instance ??= createUsersRepository(getDb());
  return instance;
}
