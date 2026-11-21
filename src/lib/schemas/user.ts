// The Users API contract, shared by the signup island and the server endpoints.
// Client and server import the same schemas, so they cannot disagree about what is valid.
// No server-only imports in this file: it is bundled into the browser.
import { z } from 'zod';

/** The market a user wants to replay first, asked on the success screen. */
export const MARKETS = ['forex', 'crypto', 'stocks', 'indices', 'futures'] as const;
export const MarketSchema = z.enum(MARKETS, 'Choose one of the listed markets');
export type Market = z.infer<typeof MarketSchema>;

export const EMAIL_MAX_LENGTH = 254;

/** Trimmed and lowercased before validation, so uniqueness is checked on the normalised value. */
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH, `Email must be at most ${EMAIL_MAX_LENGTH} characters`)
  .pipe(z.email('Enter a valid email address'));

/** POST /api/users */
export const CreateUserBodySchema = z.strictObject({
  email: EmailSchema,
});
export type CreateUserBody = z.input<typeof CreateUserBodySchema>;
export type CreateUserInput = z.output<typeof CreateUserBodySchema>;

/** PATCH /api/users/:id. The only editable field; required. */
export const UpdateUserBodySchema = z.strictObject({
  preferredMarket: MarketSchema,
});
export type UpdateUserBody = z.input<typeof UpdateUserBodySchema>;
export type UpdateUserInput = z.output<typeof UpdateUserBodySchema>;

export const UserIdSchema = z.uuid();

export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** The `Idempotency-Key` request header on POST: 1-255 printable ASCII characters. */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[\x20-\x7e]+$/, 'Idempotency-Key must be printable ASCII')
  .max(
    IDEMPOTENCY_KEY_MAX_LENGTH,
    `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
  );

export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 100;

/** GET /api/users query. The cursor is opaque here; the server decodes it. */
export const ListUsersQuerySchema = z.object({
  limit: z.coerce
    .number('limit must be a number')
    .int('limit must be an integer')
    .min(1, 'limit must be at least 1')
    .max(LIST_LIMIT_MAX, `limit must be at most ${LIST_LIMIT_MAX}`)
    .default(LIST_LIMIT_DEFAULT),
  cursor: z.string().min(1, 'Invalid cursor').max(512, 'Invalid cursor').optional(),
});
export type ListUsersQuery = z.output<typeof ListUsersQuerySchema>;

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  preferredMarket: MarketSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

export const UserResponseSchema = z.object({ user: UserSchema });
export type UserResponse = z.infer<typeof UserResponseSchema>;

export const ListUsersResponseSchema = z.object({
  users: z.array(UserSchema),
  nextCursor: z.string().nullable(),
});
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const ERROR_CODES = [
  'bad_request',
  'validation_error',
  'idempotency_key_reused',
  'email_taken',
  'not_found',
  'unauthorized',
  'payload_too_large',
  'rate_limited',
  'internal',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** The one error envelope every endpoint returns. `fields` maps a field path to a message. */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
