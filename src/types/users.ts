// Server-only contract types for src/lib/server/users-repository.ts. Type-only: no runtime code.
// Request and response shapes are NOT declared here: they are inferred from the zod schemas in
// src/lib/schemas/user.ts, the single source of truth.
import type { CreateUserInput, UpdateUserInput, User } from '../lib/schemas/user';

// Results: expected failures are values, not exceptions.

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
