// Server-only. Opens the SQLite database and migrates it to the current schema.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_DATABASE_PATH = './data/app.db';

/**
 * Ordered migrations, keyed on `PRAGMA user_version`: entry `i` takes the database from
 * version `i` to `i + 1`. Append only; never edit a migration that has shipped.
 */
const MIGRATIONS: readonly string[] = [
  // v1: the original schema. IF NOT EXISTS because databases created before versioning
  // already hold this table at user_version 0.
  `
  CREATE TABLE IF NOT EXISTS users (
    id               TEXT PRIMARY KEY,
    email            TEXT NOT NULL,
    name             TEXT,
    experience_level TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);
  CREATE INDEX IF NOT EXISTS users_created_at_id ON users (created_at DESC, id DESC);
  `,
  // v2: the market replaces name and experience level; idempotency keys for POST /api/users.
  // DROP COLUMN needs SQLite >= 3.35, which better-sqlite3 bundles.
  `
  ALTER TABLE users ADD COLUMN preferred_market TEXT;
  ALTER TABLE users DROP COLUMN name;
  ALTER TABLE users DROP COLUMN experience_level;
  CREATE TABLE idempotency_keys (
    key           TEXT PRIMARY KEY,
    request_hash  TEXT NOT NULL,
    response_body TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX idempotency_keys_created_at ON idempotency_keys (created_at);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

const userVersion = (db: Database.Database) =>
  db.pragma('user_version', { simple: true }) as number;

/**
 * Applies every migration above the database's user_version, each in its own IMMEDIATE
 * transaction that re-reads the version first, so two processes opening the same file
 * cannot both apply a step.
 */
export function migrate(db: Database.Database): void {
  while (userVersion(db) < MIGRATIONS.length) {
    db.transaction(() => {
      const version = userVersion(db);
      const step = MIGRATIONS[version];
      if (step === undefined) return;
      db.exec(step);
      db.pragma(`user_version = ${version + 1}`);
    }).immediate();
  }
}

/** Opens a database at `filePath` (or `:memory:`) migrated to SCHEMA_VERSION. */
export function openDatabase(filePath: string): Database.Database {
  if (filePath !== ':memory:') {
    mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

let instance: Database.Database | undefined;

/** The process-wide database, opened on first use at DATABASE_PATH. */
export function getDb(): Database.Database {
  instance ??= openDatabase(process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH);
  return instance;
}
