// The signup state machine: email -> POST /api/users, then the preferred market -> PATCH.
// No DOM access here: focus moves are the component's job, through the onInvalid/onSuccess hooks,
// which run after the DOM has updated. Validation uses the same zod schemas as the server.
// Analytics: the submit -> sign_up | signup_failure events fire here, where the outcome is known.
import { computed, nextTick, ref, watch } from 'vue';
import type { ZodError } from 'zod';
import * as usersApi from '../lib/api/users';
import { track as defaultTrack } from '../analytics/track';
import type { FieldErrorCode, SignupStep } from '../analytics/taxonomy';
import { EmailSchema, MarketSchema, type Market } from '../lib/schemas/user';
import { MARKET_LABELS } from '../components/signup/markets';
import type { CreateUserResult, SignupState } from '../types/signup';

export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";
export const SAVE_ERROR = "We couldn't save your choice. Please try again.";
export const CHOOSE_MARKET = 'Choose a market, then save.';

export type SignupApi = Pick<typeof usersApi, 'createUser' | 'updatePreferredMarket'>;

export type UseSignupOptions = {
  /** After the state became `invalid` and the DOM updated: focus the email field. */
  onInvalid?: () => void;
  /** After the state became `success` and the DOM updated: focus the success heading. */
  onSuccess?: () => void;
  /** The API client; injectable so tests need no network. */
  api?: SignupApi;
  /** The analytics sink; injectable so tests can assert events. */
  track?: typeof defaultTrack;
};

/**
 * Where the flow is, for signup_modal_close. `email` means no POST was ever sent: the drop-off
 * before submit. `rejected` is back on the email step after a sent POST failed (409, 422, …).
 */
export function signupStep(state: SignupState, submitted: boolean): SignupStep {
  if (state.status === 'submitting') return 'submitting';
  if (state.status === 'error') return 'error';
  if (state.status !== 'success') return submitted ? 'rejected' : 'email';
  return state.market.status === 'saved' ? 'done' : 'market';
}

/** A client-side email error as an analytics code: never the input or the message. */
function clientErrorCode(email: string, error: ZodError): FieldErrorCode {
  if (email.trim() === '') return 'required';
  return error.issues.some((issue) => issue.code === 'too_big') ? 'too_long' : 'invalid_format';
}

const newKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : undefined;

function errorMessage(result: Exclude<CreateUserResult, { ok: true } | { kind: 'field' }>) {
  if (result.kind === 'network') return NETWORK_ERROR;
  if (result.kind === 'rate_limited') {
    const seconds = result.retryAfterSeconds;
    const wait = seconds ? `in ${seconds} second${seconds === 1 ? '' : 's'}` : 'in a moment';
    return `Too many attempts. Please try again ${wait}.`;
  }
  return GENERIC_ERROR;
}

export function useSignup({
  onInvalid,
  onSuccess,
  api = usersApi,
  track = defaultTrack,
}: UseSignupOptions = {}) {
  const state = ref<SignupState>({ status: 'idle' });
  const email = ref('');
  const selectedMarket = ref<Market | null>(null);

  // One key per normalised email: a retry of the same email reuses it, so a lost 201 is replayed
  // (and sign_up still fires) instead of becoming a 409. Editing the email to another address
  // uses another key; editing it back reuses the first one.
  const idempotencyKeys = new Map<string, string | undefined>();
  /** A POST has been sent in this page view: closing now is no longer a drop-off before submit. */
  let submitted = false;
  watch(email, () => {
    if (state.value.status === 'invalid' || state.value.status === 'error') {
      state.value = { status: 'idle' };
    }
  });

  const emailError = computed(() =>
    state.value.status === 'invalid' ? state.value.fields.email : null,
  );

  /** A request is in flight: the dialog must not close, so no result lands in a closed dialog. */
  const busy = computed(
    () =>
      state.value.status === 'submitting' ||
      (state.value.status === 'success' && state.value.market.status === 'saving'),
  );

  /** The one message for the persistent live region. */
  const statusMessage = computed(() => {
    const s = state.value;
    if (s.status === 'submitting') return 'Creating your account…';
    if (s.status === 'error') return s.message;
    if (s.status !== 'success') return '';
    if (s.market.status === 'saving') return 'Saving…';
    if (s.market.status === 'saved') return `Saved: ${MARKET_LABELS[s.market.market]}.`;
    if (s.market.status === 'error') return s.market.message;
    return '';
  });

  const isError = computed(
    () =>
      state.value.status === 'error' ||
      (state.value.status === 'success' && state.value.market.status === 'error'),
  );

  async function showInvalid(message: string, code: FieldErrorCode) {
    track('signup_field_error', { field: 'email', code });
    state.value = { status: 'invalid', fields: { email: message } };
    await nextTick();
    onInvalid?.();
  }

  async function submit() {
    // A success is final: closing and reopening the dialog shows it, never a second signup.
    if (state.value.status === 'submitting' || state.value.status === 'success') return;

    const parsed = EmailSchema.safeParse(email.value);
    if (!parsed.success) {
      await showInvalid(
        parsed.error.issues[0]?.message ?? 'Enter a valid email address',
        clientErrorCode(email.value, parsed.error),
      );
      return;
    }

    if (!idempotencyKeys.has(parsed.data)) idempotencyKeys.set(parsed.data, newKey());
    state.value = { status: 'submitting' };
    submitted = true;
    track('signup_submit', {});

    const result = await api.createUser(parsed.data, idempotencyKeys.get(parsed.data));
    if (result.ok) {
      // Only on 201. No email and no users.id: the id authorises PATCH (DECISIONS).
      track('sign_up', { method: 'email' });
      state.value = { status: 'success', user: result.user, market: { status: 'idle' } };
      await nextTick();
      onSuccess?.();
      return;
    }
    if (result.kind === 'field') {
      track('signup_failure', { reason: result.code });
      await showInvalid(
        result.message,
        result.code === 'email_taken' ? 'email_taken' : 'invalid_format',
      );
      return;
    }
    track('signup_failure', { reason: result.kind });
    state.value = { status: 'error', message: errorMessage(result) };
  }

  async function saveMarket() {
    const s = state.value;
    if (s.status !== 'success' || s.market.status === 'saving') return;

    const market = MarketSchema.safeParse(selectedMarket.value);
    if (!market.success) {
      s.market = { status: 'error', message: CHOOSE_MARKET };
      return;
    }

    s.market = { status: 'saving' };
    const result = await api.updatePreferredMarket(s.user.id, market.data);
    if (!result.ok) {
      s.market = {
        status: 'error',
        message: result.kind === 'network' ? NETWORK_ERROR : SAVE_ERROR,
      };
      return;
    }
    s.user = result.user;
    s.market = { status: 'saved', market: market.data };
    track('market_selected', { market: market.data });
  }

  /** The step reported by signup_modal_close. */
  const step = (): SignupStep => signupStep(state.value, submitted);

  return {
    state,
    step,
    email,
    selectedMarket,
    emailError,
    busy,
    statusMessage,
    isError,
    submit,
    saveMarket,
  };
}
