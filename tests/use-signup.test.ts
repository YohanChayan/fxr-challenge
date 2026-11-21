import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import {
  signupStep,
  CHOOSE_MARKET,
  GENERIC_ERROR,
  NETWORK_ERROR,
  SAVE_ERROR,
  useSignup,
  type SignupApi,
} from '../src/composables/useSignup';
import type { User } from '../src/lib/schemas/user';
import type { CreateUserResult, UpdateMarketResult } from '../src/types/signup';

const USER: User = {
  id: '3f1c2a5e-8b7d-4c6a-9e2f-1a2b3c4d5e6f',
  email: 'trader@example.com',
  preferredMarket: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** A promise the test resolves by hand, to observe the in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(
  createUser: SignupApi['createUser'] = async () => ({ ok: true, user: USER }),
  updatePreferredMarket: SignupApi['updatePreferredMarket'] = async (_id, market) => ({
    ok: true,
    user: { ...USER, preferredMarket: market },
  }),
) {
  const api = {
    createUser: vi.fn(createUser),
    updatePreferredMarket: vi.fn(updatePreferredMarket),
  };
  const onInvalid = vi.fn();
  const onSuccess = vi.fn();
  const track = vi.fn();
  const signup = useSignup({ api, onInvalid, onSuccess, track });
  return { ...signup, api, onInvalid, onSuccess, track };
}

/** Sets the email and lets its watcher run, as typing does long before a submit. */
async function type(s: { email: { value: string } }, value: string) {
  s.email.value = value;
  await nextTick();
}

/** A signup that has reached `success`. */
async function signedUp(updatePreferredMarket?: SignupApi['updatePreferredMarket']) {
  const s = setup(undefined, updatePreferredMarket);
  await type(s, 'trader@example.com');
  await s.submit();
  expect(s.state.value.status).toBe('success');
  return s;
}

describe('useSignup: email step', () => {
  it('starts idle, not busy, with no message', () => {
    const s = setup();
    expect(s.state.value).toEqual({ status: 'idle' });
    expect(s.busy.value).toBe(false);
    expect(s.statusMessage.value).toBe('');
    expect(s.emailError.value).toBeNull();
  });

  it('rejects an invalid email locally and calls onInvalid, without a request', async () => {
    const s = setup();
    await type(s, 'not-an-email');
    await s.submit();
    expect(s.state.value).toEqual({
      status: 'invalid',
      fields: { email: 'Enter a valid email address' },
    });
    expect(s.emailError.value).toBe('Enter a valid email address');
    expect(s.onInvalid).toHaveBeenCalledTimes(1);
    expect(s.api.createUser).not.toHaveBeenCalled();
  });

  it('sends the normalised email, is busy in flight, and ignores a second submit', async () => {
    const pending = deferred<CreateUserResult>();
    const s = setup(() => pending.promise);
    await type(s, '  Trader@Example.com ');

    const first = s.submit();
    expect(s.state.value).toEqual({ status: 'submitting' });
    expect(s.busy.value).toBe(true);
    expect(s.statusMessage.value).toBe('Creating your account…');

    await s.submit();
    expect(s.api.createUser).toHaveBeenCalledTimes(1);
    expect(s.api.createUser.mock.calls[0]?.[0]).toBe('trader@example.com');
    expect(typeof s.api.createUser.mock.calls[0]?.[1]).toBe('string');

    pending.resolve({ ok: true, user: USER });
    await first;
    expect(s.state.value).toEqual({ status: 'success', user: USER, market: { status: 'idle' } });
    expect(s.busy.value).toBe(false);
    expect(s.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('never signs up twice: submit after success is a no-op', async () => {
    const s = await signedUp();
    await s.submit();
    expect(s.api.createUser).toHaveBeenCalledTimes(1);
    expect(s.state.value.status).toBe('success');
  });

  it('shows a 409/422 field message inline and calls onInvalid', async () => {
    const s = setup(async () => ({
      ok: false,
      kind: 'field',
      code: 'email_taken',
      message: 'Already registered',
    }));
    await type(s, 'trader@example.com');
    await s.submit();
    expect(s.state.value).toEqual({ status: 'invalid', fields: { email: 'Already registered' } });
    expect(s.onInvalid).toHaveBeenCalledTimes(1);
    expect(s.onSuccess).not.toHaveBeenCalled();
  });

  it.each([
    [42, 'Too many attempts. Please try again in 42 seconds.'],
    [1, 'Too many attempts. Please try again in 1 second.'],
    [null, 'Too many attempts. Please try again in a moment.'],
  ])('words a 429 with retryAfterSeconds %s', async (retryAfterSeconds, message) => {
    const s = setup(async () => ({ ok: false, kind: 'rate_limited', retryAfterSeconds }));
    await type(s, 'trader@example.com');
    await s.submit();
    expect(s.state.value).toEqual({ status: 'error', message });
    expect(s.statusMessage.value).toBe(message);
    expect(s.isError.value).toBe(true);
  });

  it('maps network and unexpected failures to their messages', async () => {
    const results: CreateUserResult[] = [
      { ok: false, kind: 'network' },
      { ok: false, kind: 'unexpected' },
    ];
    const s = setup(async () => results.shift() ?? { ok: false, kind: 'unexpected' });
    await type(s, 'trader@example.com');
    await s.submit();
    expect(s.state.value).toEqual({ status: 'error', message: NETWORK_ERROR });
    await s.submit();
    expect(s.state.value).toEqual({ status: 'error', message: GENERIC_ERROR });
  });

  it('a retry of the same email reuses the Idempotency-Key; editing it starts a new one', async () => {
    const s = setup(async () => ({ ok: false, kind: 'network' }));
    await type(s, 'trader@example.com');
    await s.submit();
    await s.submit();
    const [first, retry] = s.api.createUser.mock.calls.map((call) => call[1]);
    expect(first).toBeTruthy();
    expect(retry).toBe(first);

    await type(s, 'other@example.com');
    expect(s.state.value).toEqual({ status: 'idle' });
    await s.submit();
    expect(s.api.createUser.mock.calls[2]?.[1]).not.toBe(first);

    // Editing back to the first address (after normalisation) reuses its key: a lost 201 for it
    // is still replayed, not turned into a 409.
    await type(s, ' Trader@Example.com ');
    await s.submit();
    expect(s.api.createUser.mock.calls[3]?.[1]).toBe(first);
  });

  it('editing the email clears an invalid state', async () => {
    const s = setup();
    await type(s, 'nope');
    await s.submit();
    expect(s.state.value.status).toBe('invalid');
    await type(s, 'nope2');
    expect(s.state.value).toEqual({ status: 'idle' });
  });
});

describe('useSignup: market step', () => {
  it('asks for a choice when none is selected, without a request', async () => {
    const s = await signedUp();
    await s.saveMarket();
    expect(s.state.value).toMatchObject({ market: { status: 'error', message: CHOOSE_MARKET } });
    expect(s.statusMessage.value).toBe(CHOOSE_MARKET);
    expect(s.isError.value).toBe(true);
    expect(s.api.updatePreferredMarket).not.toHaveBeenCalled();
  });

  it('is busy while saving, ignores a second save, then announces the saved market', async () => {
    const pending = deferred<UpdateMarketResult>();
    const s = await signedUp(() => pending.promise);
    s.selectedMarket.value = 'crypto';

    const first = s.saveMarket();
    expect(s.state.value).toMatchObject({ market: { status: 'saving' } });
    expect(s.busy.value).toBe(true);
    expect(s.statusMessage.value).toBe('Saving…');
    await s.saveMarket();
    expect(s.api.updatePreferredMarket).toHaveBeenCalledTimes(1);
    expect(s.api.updatePreferredMarket).toHaveBeenCalledWith(USER.id, 'crypto');

    const updated = { ...USER, preferredMarket: 'crypto' as const };
    pending.resolve({ ok: true, user: updated });
    await first;
    expect(s.state.value).toEqual({
      status: 'success',
      user: updated,
      market: { status: 'saved', market: 'crypto' },
    });
    expect(s.busy.value).toBe(false);
    expect(s.statusMessage.value).toBe('Saved: Crypto.');
  });

  it.each([
    ['network', NETWORK_ERROR],
    ['unexpected', SAVE_ERROR],
  ] as const)('maps a %s failure to its message', async (kind, message) => {
    const s = await signedUp(async () => ({ ok: false, kind }));
    s.selectedMarket.value = 'forex';
    await s.saveMarket();
    expect(s.state.value).toMatchObject({ market: { status: 'error', message } });
    expect(s.statusMessage.value).toBe(message);
  });

  it('saveMarket before success does nothing', async () => {
    const s = setup();
    s.selectedMarket.value = 'forex';
    await s.saveMarket();
    expect(s.state.value).toEqual({ status: 'idle' });
    expect(s.api.updatePreferredMarket).not.toHaveBeenCalled();
  });
});

describe('useSignup analytics', () => {
  const events = (s: { track: ReturnType<typeof vi.fn> }) => s.track.mock.calls;

  it('201: signup_submit then sign_up, with no email or user id anywhere', async () => {
    const s = await signedUp();
    expect(events(s)).toEqual([
      ['signup_submit', {}],
      ['sign_up', { method: 'email' }],
    ]);
    const serialised = JSON.stringify(events(s));
    expect(serialised).not.toContain(USER.email);
    expect(serialised).not.toContain(USER.id);
  });

  it.each([
    ['', 'required'],
    ['not-an-email', 'invalid_format'],
    [`${'a'.repeat(250)}@x.com`, 'too_long'],
  ])('client error on %j: only signup_field_error (%s), nothing sent', async (value, code) => {
    const s = setup();
    await type(s, value);
    await s.submit();
    expect(events(s)).toEqual([['signup_field_error', { field: 'email', code }]]);
    expect(s.api.createUser).not.toHaveBeenCalled();
  });

  it('409: submit, failure email_taken and a field error', async () => {
    const s = setup(async () => ({
      ok: false,
      kind: 'field',
      code: 'email_taken',
      message: 'Already registered',
    }));
    await type(s, 'trader@example.com');
    await s.submit();
    expect(events(s)).toEqual([
      ['signup_submit', {}],
      ['signup_failure', { reason: 'email_taken' }],
      ['signup_field_error', { field: 'email', code: 'email_taken' }],
    ]);
  });

  it('server 422: failure invalid_email and field error invalid_format', async () => {
    const s = setup(async () => ({
      ok: false,
      kind: 'field',
      code: 'invalid_email',
      message: 'Enter a valid email address',
    }));
    await type(s, 'trader@example.com');
    await s.submit();
    expect(events(s)).toEqual([
      ['signup_submit', {}],
      ['signup_failure', { reason: 'invalid_email' }],
      ['signup_field_error', { field: 'email', code: 'invalid_format' }],
    ]);
  });

  it.each([
    [{ ok: false, kind: 'network' } as const, 'network'],
    [{ ok: false, kind: 'unexpected' } as const, 'unexpected'],
    [{ ok: false, kind: 'rate_limited', retryAfterSeconds: 5 } as const, 'rate_limited'],
  ])('%j: signup_failure %s; Retry sends a second submit', async (result, reason) => {
    const s = setup(async () => result);
    await type(s, 'trader@example.com');
    await s.submit();
    await s.submit();
    expect(events(s)).toEqual([
      ['signup_submit', {}],
      ['signup_failure', { reason }],
      ['signup_submit', {}],
      ['signup_failure', { reason }],
    ]);
  });

  it('a submit ignored while one is in flight tracks nothing', async () => {
    const pending = deferred<CreateUserResult>();
    const s = setup(() => pending.promise);
    await type(s, 'trader@example.com');
    const first = s.submit();
    await s.submit();
    pending.resolve({ ok: true, user: USER });
    await first;
    expect(events(s).map(([name]) => name)).toEqual(['signup_submit', 'sign_up']);
  });

  it('market_selected fires only when the PATCH saved it', async () => {
    const s = await signedUp(async () => ({ ok: false, kind: 'network' }));
    s.selectedMarket.value = 'crypto';
    await s.saveMarket();
    expect(events(s).map(([name]) => name)).not.toContain('market_selected');

    const ok = await signedUp();
    ok.selectedMarket.value = 'crypto';
    await ok.saveMarket();
    expect(events(ok).at(-1)).toEqual(['market_selected', { market: 'crypto' }]);
  });

  it('signupStep maps each state to the step reported on close', () => {
    expect(signupStep({ status: 'idle' }, false)).toBe('email');
    expect(signupStep({ status: 'invalid', fields: { email: 'x' } }, false)).toBe('email');
    expect(signupStep({ status: 'invalid', fields: { email: 'x' } }, true)).toBe('rejected');
    expect(signupStep({ status: 'idle' }, true)).toBe('rejected');
    expect(signupStep({ status: 'submitting' }, true)).toBe('submitting');
    expect(signupStep({ status: 'error', message: 'x' }, true)).toBe('error');
    expect(signupStep({ status: 'success', user: USER, market: { status: 'idle' } }, true)).toBe(
      'market',
    );
    expect(
      signupStep(
        { status: 'success', user: USER, market: { status: 'saved', market: 'forex' } },
        true,
      ),
    ).toBe('done');
  });

  it("step(): 'email' until a POST is sent, 'rejected' after a 409", async () => {
    const s = setup(async () => ({
      ok: false,
      kind: 'field',
      code: 'email_taken',
      message: 'Already registered',
    }));
    await type(s, 'nope');
    await s.submit();
    expect(s.step()).toBe('email');
    await type(s, 'trader@example.com');
    await s.submit();
    expect(s.step()).toBe('rejected');
  });
});
