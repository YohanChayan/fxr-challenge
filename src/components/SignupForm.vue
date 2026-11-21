<script setup lang="ts">
// The signup island: email -> POST /api/users, then the preferred market -> PATCH.
// Validation and response parsing use the same zod schemas as the server.
import { computed, nextTick, ref, watch } from 'vue';
import {
  EmailSchema,
  ErrorResponseSchema,
  MARKETS,
  MarketSchema,
  UserResponseSchema,
  type Market,
  type User,
} from '../lib/schemas/user';

const MARKET_LABELS: Record<Market, string> = {
  forex: 'Forex',
  crypto: 'Crypto',
  stocks: 'Stocks',
  indices: 'Indices',
  futures: 'Futures',
};

const GENERIC_ERROR = 'Something went wrong. Please try again.';
const NETWORK_ERROR = "We couldn't reach the server. Check your connection and try again.";

type MarketState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; market: Market }
  | { status: 'error'; message: string };

type State =
  | { status: 'idle' }
  | { status: 'invalid'; fields: { email: string } }
  | { status: 'submitting' }
  | { status: 'error'; message: string }
  // The user (and its id, which authorises PATCH) lives here only: never in storage, the URL
  // or logs.
  | { status: 'success'; user: User; market: MarketState };

const state = ref<State>({ status: 'idle' });
const email = ref('');
const selectedMarket = ref<Market | null>(null);
const emailInput = ref<HTMLInputElement | null>(null);
const successHeading = ref<HTMLHeadingElement | null>(null);

// One key per email value: a retry of the same email reuses it, so a lost 201 is replayed
// instead of becoming a 409. Editing the email starts a new key.
let idempotencyKey: string | undefined;
watch(email, () => {
  idempotencyKey = undefined;
  if (state.value.status === 'invalid' || state.value.status === 'error') {
    state.value = { status: 'idle' };
  }
});

const newKey = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : undefined;

const emailError = computed(() =>
  state.value.status === 'invalid' ? state.value.fields.email : null,
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

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function showInvalid(message: string) {
  state.value = { status: 'invalid', fields: { email: message } };
  await nextTick();
  emailInput.value?.focus();
}

async function submit() {
  if (state.value.status === 'submitting') return;

  const parsed = EmailSchema.safeParse(email.value);
  if (!parsed.success) {
    await showInvalid(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
    return;
  }

  idempotencyKey ??= newKey();
  state.value = { status: 'submitting' };

  let res: Response;
  try {
    res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ email: parsed.data }),
    });
  } catch {
    state.value = { status: 'error', message: NETWORK_ERROR };
    return;
  }

  if (res.status === 201) {
    const body = UserResponseSchema.safeParse(await readJson(res));
    if (!body.success) {
      state.value = { status: 'error', message: GENERIC_ERROR };
      return;
    }
    // TODO(analytics): sign_up fires here on 201 — via /add-event; no email or users.id in properties.
    state.value = { status: 'success', user: body.data.user, market: { status: 'idle' } };
    await nextTick();
    successHeading.value?.focus();
    return;
  }

  const error = ErrorResponseSchema.safeParse(await readJson(res));
  const fieldMessage = error.success ? error.data.error.fields?.email : undefined;
  if ((res.status === 409 || res.status === 422) && fieldMessage) {
    await showInvalid(fieldMessage);
    return;
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get('retry-after'));
    const wait =
      Number.isFinite(seconds) && seconds > 0
        ? `in ${seconds} second${seconds === 1 ? '' : 's'}`
        : 'in a moment';
    state.value = { status: 'error', message: `Too many attempts. Please try again ${wait}.` };
    return;
  }
  state.value = { status: 'error', message: GENERIC_ERROR };
}

async function saveMarket() {
  const s = state.value;
  if (s.status !== 'success' || s.market.status === 'saving') return;

  const market = MarketSchema.safeParse(selectedMarket.value);
  if (!market.success) {
    s.market = { status: 'error', message: 'Choose a market, then save.' };
    return;
  }

  s.market = { status: 'saving' };
  let res: Response;
  try {
    res = await fetch(`/api/users/${encodeURIComponent(s.user.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferredMarket: market.data }),
    });
  } catch {
    s.market = { status: 'error', message: NETWORK_ERROR };
    return;
  }

  const body = res.ok ? UserResponseSchema.safeParse(await readJson(res)) : null;
  if (!body?.success) {
    s.market = { status: 'error', message: "We couldn't save your choice. Please try again." };
    return;
  }
  s.user = body.data.user;
  s.market = { status: 'saved', market: market.data };
}
</script>

<template>
  <div class="signup-island">
    <!-- method="post": a submit before hydration never puts the email in a URL. -->
    <form
      v-if="state.status !== 'success'"
      class="signup-form"
      method="post"
      novalidate
      aria-label="Create your free account"
      :aria-busy="state.status === 'submitting' ? 'true' : undefined"
      @submit.prevent="submit"
    >
      <label class="label" for="signup-email">Email address</label>
      <div class="row">
        <input
          id="signup-email"
          ref="emailInput"
          v-model="email"
          class="input"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          spellcheck="false"
          required
          :readonly="state.status === 'submitting'"
          :aria-invalid="emailError ? 'true' : undefined"
          :aria-describedby="emailError ? 'signup-email-error' : undefined"
        />
        <button class="button" type="submit" :disabled="state.status === 'submitting'">
          {{ state.status === 'submitting' ? 'Creating account…' : 'Create free account' }}
        </button>
      </div>
      <!-- role="alert": focus is usually already on the input, so re-focusing announces nothing. -->
      <p v-if="emailError" id="signup-email-error" class="field-error" role="alert">
        {{ emailError }}
      </p>
    </form>

    <div v-else class="success">
      <h2 ref="successHeading" class="success-title" tabindex="-1">Your free account is ready</h2>
      <form class="market-form" novalidate @submit.prevent="saveMarket">
        <!-- Not disabled while saving: disabling the focused control drops focus to <body>.
             saveMarket() ignores a second submit, and the button is aria-disabled instead. -->
        <fieldset class="fieldset">
          <legend class="legend">Which market do you want to replay first?</legend>
          <div class="options">
            <label v-for="market in MARKETS" :key="market" class="option">
              <input
                v-model="selectedMarket"
                class="radio"
                type="radio"
                name="preferred-market"
                :value="market"
              />
              {{ MARKET_LABELS[market] }}
            </label>
          </div>
        </fieldset>
        <button
          class="button"
          type="submit"
          :aria-disabled="state.market.status === 'saving' ? 'true' : undefined"
        >
          {{ state.market.status === 'saving' ? 'Saving…' : 'Save' }}
        </button>
      </form>
    </div>

    <div class="feedback">
      <p
        class="status"
        :class="{
          'is-error':
            state.status === 'error' ||
            (state.status === 'success' && state.market.status === 'error'),
        }"
        role="status"
        aria-live="polite"
      >
        {{ statusMessage }}
      </p>
      <button
        v-if="state.status === 'error'"
        class="button secondary"
        type="button"
        @click="submit"
      >
        Retry
      </button>
    </div>
  </div>
</template>

<style scoped>
.signup-island {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: var(--font-body);
}

.signup-form,
.market-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label,
.legend {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 1rem;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input {
  min-height: 48px;
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-brand);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: 1rem;
}

/* Stays --border-brand: --border-error is ~2.5:1 on the page background (WCAG 1.4.11 needs 3:1).
   The error text carries the meaning; the thicker border marks the field. */
.input[aria-invalid='true'] {
  border-width: 2px;
}

.field-error {
  color: var(--text-error);
  font-size: 0.9375rem;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 12px 28px;
  border: 0;
  border-radius: 8px;
  background: var(--btn-bg-primary-active);
  color: var(--btn-text);
  font: inherit;
  font-weight: 700;
  font-size: 1.0625rem;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.button:hover {
  background: var(--btn-bg-primary-hover);
}

.button:active {
  background: var(--btn-bg-primary-pressed);
}

.button:disabled,
.button[aria-disabled='true'] {
  background: var(--btn-bg-primary-disabled);
  color: var(--btn-text-disabled);
  cursor: not-allowed;
}

.button.secondary {
  align-self: flex-start;
  background: var(--btn-bg-secondary-active);
}

.button.secondary:hover {
  background: var(--btn-bg-secondary-hover);
}

.button.secondary:active {
  background: var(--btn-bg-secondary-pressed);
}

.success {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.success-title {
  color: var(--text-primary);
  font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
}

.fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 12px 16px;
  border: 1px solid var(--btn-border-outline);
  border-radius: 8px;
  background: var(--btn-bg-outline-active);
  color: var(--text-primary);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.option:hover {
  background: var(--btn-bg-outline-hover);
}

.option:has(.radio:checked) {
  border-color: var(--border-brand);
}

.radio {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--border-brand);
}

.feedback {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.status {
  color: var(--text-secondary);
  font-size: 0.9375rem;
}

.status.is-error {
  color: var(--text-error);
}

@media (min-width: 768px) {
  .row {
    flex-direction: row;
  }

  .input {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .button,
  .option {
    transition: none;
  }
}
</style>
