import { describe, expect, it } from 'vitest';
import {
  CreateUserBodySchema,
  IdempotencyKeySchema,
  ListUsersQuerySchema,
  MARKETS,
  MarketSchema,
  UpdateUserBodySchema,
  UserIdSchema,
} from '../src/lib/schemas/user';

describe('CreateUserBodySchema', () => {
  it('trims and lowercases the email', () => {
    expect(CreateUserBodySchema.parse({ email: '  Trader@Example.COM ' })).toEqual({
      email: 'trader@example.com',
    });
  });

  it.each(['', 'not-an-email', 'a@b', '@example.com', 42, null])('rejects %j', (email) => {
    const result = CreateUserBodySchema.safeParse({ email });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['email']);
  });

  it('rejects an email over 254 characters', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(186)}.com`; // 255 chars
    expect(email).toHaveLength(255);
    expect(CreateUserBodySchema.safeParse({ email }).success).toBe(false);
  });

  it('rejects a missing email', () => {
    expect(CreateUserBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = CreateUserBodySchema.safeParse({ email: 'a@example.com', name: 'Ann' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['name'] });
  });
});

describe('MarketSchema', () => {
  it('accepts exactly the five markets', () => {
    expect(MARKETS).toEqual(['forex', 'crypto', 'stocks', 'indices', 'futures']);
    for (const market of MARKETS) expect(MarketSchema.parse(market)).toBe(market);
  });

  it.each(['Forex', 'commodities', '', null, undefined, 1])('rejects %j', (value) => {
    const result = MarketSchema.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Choose one of the listed markets');
  });
});

describe('UpdateUserBodySchema', () => {
  it('accepts a preferred market', () => {
    expect(UpdateUserBodySchema.parse({ preferredMarket: 'crypto' })).toEqual({
      preferredMarket: 'crypto',
    });
  });

  it('requires preferredMarket and does not accept null', () => {
    expect(UpdateUserBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateUserBodySchema.safeParse({ preferredMarket: null }).success).toBe(false);
  });

  it.each(['name', 'experienceLevel', 'email'])('rejects the unknown key %s', (key) => {
    const result = UpdateUserBodySchema.safeParse({ preferredMarket: 'forex', [key]: 'x' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: [key] });
  });
});

describe('IdempotencyKeySchema', () => {
  it('accepts a uuid and any printable ASCII up to 255 characters', () => {
    expect(IdempotencyKeySchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('a b~!').success).toBe(true);
    expect(IdempotencyKeySchema.safeParse('a'.repeat(255)).success).toBe(true);
  });

  it.each(['', 'a'.repeat(256), 'tab\there', 'clé', 'line\nbreak'])('rejects %j', (key) => {
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('ListUsersQuerySchema', () => {
  it('defaults limit to 20', () => {
    expect(ListUsersQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('coerces limit from a query string', () => {
    expect(ListUsersQuerySchema.parse({ limit: '5', cursor: 'abc' })).toEqual({
      limit: 5,
      cursor: 'abc',
    });
  });

  it.each(['0', '101', '-1', '2.5', 'abc', ''])('rejects limit=%j', (limit) => {
    expect(ListUsersQuerySchema.safeParse({ limit }).success).toBe(false);
  });

  it('accepts the bounds', () => {
    expect(ListUsersQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(ListUsersQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });
});

describe('UserIdSchema', () => {
  it('accepts a uuid and rejects anything else', () => {
    expect(UserIdSchema.safeParse(crypto.randomUUID()).success).toBe(true);
    expect(UserIdSchema.safeParse('123').success).toBe(false);
  });
});
