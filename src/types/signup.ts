// Browser-side types for the signup island and its API client. Type-only: no runtime code.
// Imports only the shared schema module, never a server module.
import type { Market, User } from '../lib/schemas/user';

export type MarketState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; market: Market }
  | { status: 'error'; message: string };

export type SignupState =
  | { status: 'idle' }
  | { status: 'invalid'; fields: { email: string } }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  // The user (and its id, which authorises PATCH) lives here only: never in storage, the URL
  // or logs.
  | { status: 'success'; user: User; market: MarketState };

/** What `createUser()` resolved to. The island maps each kind to its copy. */
export type CreateUserResult =
  | { ok: true; user: User }
  /** 409 or 422 with `fields.email`: shown inline on the field. `code` is for analytics only. */
  | { ok: false; kind: 'field'; code: 'email_taken' | 'invalid_email'; message: string }
  /** 429. `retryAfterSeconds` is null when the header is missing or not a positive number. */
  | { ok: false; kind: 'rate_limited'; retryAfterSeconds: number | null }
  /** fetch() rejected: offline, DNS, aborted. */
  | { ok: false; kind: 'network' }
  /** Any other status, or a body that does not match the contract. */
  | { ok: false; kind: 'unexpected' };

/** What `updatePreferredMarket()` resolved to. */
export type UpdateMarketResult =
  { ok: true; user: User } | { ok: false; kind: 'network' } | { ok: false; kind: 'unexpected' };
