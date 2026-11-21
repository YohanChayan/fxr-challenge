import Database from 'better-sqlite3';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('db', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'fxr-db-test-'));
    vi.resetModules(); // getDb() caches a singleton per module instance
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens DATABASE_PATH, creating missing directories, with the schema in place', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'app.db');
    vi.stubEnv('DATABASE_PATH', file);
    const { getDb } = await import('../src/lib/server/db');

    const db = getDb();
    try {
      expect(existsSync(file)).toBe(true);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      const indexes = db
        .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)
        .all()
        .map((row) => row.name);
      expect(indexes).toEqual(
        expect.arrayContaining(['users_email_unique', 'users_created_at_id']),
      );
      expect(getDb()).toBe(db);
    } finally {
      db.close();
    }
  });

  it('creates the schema idempotently when reopening an existing file', async () => {
    const file = path.join(dir, 'app.db');
    const { openDatabase } = await import('../src/lib/server/db');
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(() => db.prepare('SELECT count(*) FROM users').get()).not.toThrow();
    db.close();
  });

  // The schema as it shipped before versioning: user_version 0, with name/experience_level.
  const V1_SCHEMA = `
    CREATE TABLE users (
      id               TEXT PRIMARY KEY,
      email            TEXT NOT NULL,
      name             TEXT,
      experience_level TEXT,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
    CREATE UNIQUE INDEX users_email_unique ON users (email);
    CREATE INDEX users_created_at_id ON users (created_at DESC, id DESC);
  `;

  const columns = (db: Database.Database, table: string) =>
    db
      .prepare<[], { name: string }>(`SELECT name FROM pragma_table_info('${table}')`)
      .all()
      .map((row) => row.name);

  it('migrates a pre-versioning v1 file to the current schema, keeping rows', async () => {
    const file = path.join(dir, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec(V1_SCHEMA);
    legacy
      .prepare(
        `INSERT INTO users VALUES ('11111111-1111-4111-8111-111111111111', 'ann@example.com',
         'Ann', 'advanced', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    legacy.close();

    const { openDatabase, SCHEMA_VERSION } = await import('../src/lib/server/db');
    const db = openDatabase(file);
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(columns(db, 'users')).toEqual([
        'id',
        'email',
        'created_at',
        'updated_at',
        'preferred_market',
      ]);
      expect(columns(db, 'idempotency_keys')).toEqual([
        'key',
        'request_hash',
        'response_body',
        'created_at',
      ]);
      expect(db.prepare('SELECT id, email, preferred_market FROM users').all()).toEqual([
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: 'ann@example.com',
          preferred_market: null,
        },
      ]);
      // The UNIQUE index survives the column drops.
      expect(() =>
        db
          .prepare(
            `INSERT INTO users (id, email, created_at, updated_at) VALUES ('x', 'ann@example.com', 'a', 'a')`,
          )
          .run(),
      ).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('is a no-op when run again on a migrated database', async () => {
    const file = path.join(dir, 'twice.db');
    const { openDatabase, migrate } = await import('../src/lib/server/db');
    const db = openDatabase(file);
    try {
      db.prepare(
        `INSERT INTO users (id, email, created_at, updated_at) VALUES ('a', 'a@example.com', 't', 't')`,
      ).run();
      expect(() => migrate(db)).not.toThrow();
      expect(db.pragma('user_version', { simple: true })).toBe(2);
      expect(db.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
    const reopened = openDatabase(file);
    expect(reopened.pragma('user_version', { simple: true })).toBe(2);
    reopened.close();
  });
});
