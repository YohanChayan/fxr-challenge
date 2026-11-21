<script setup lang="ts">
// The email step. Presentational: state and submit logic live in useSignup().
import { useTemplateRef } from 'vue';

defineProps<{
  submitting: boolean;
  /** The inline field error, or null. */
  error: string | null;
}>();
const email = defineModel<string>('email', { required: true });
// interact: any focus or input inside the form; the island decides which is a form start.
const emit = defineEmits<{ submit: []; interact: [event: Event] }>();

const input = useTemplateRef<HTMLInputElement>('input');
defineExpose({ focus: () => input.value?.focus() });
</script>

<template>
  <!-- method="post" is a safe default only: before hydration the form sits in a closed <dialog>
       and cannot be submitted. No aria-label: the dialog's h2 already names it. -->
  <form
    class="signup-form"
    method="post"
    novalidate
    :aria-busy="submitting ? 'true' : undefined"
    @submit.prevent="emit('submit')"
    @focusin="emit('interact', $event)"
    @input="emit('interact', $event)"
  >
    <label class="label" for="signup-email">Email address</label>
    <div class="row">
      <input
        id="signup-email"
        ref="input"
        v-model="email"
        class="input"
        type="email"
        name="email"
        autocomplete="email"
        inputmode="email"
        spellcheck="false"
        required
        :readonly="submitting"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="error ? 'signup-email-error' : undefined"
      />
      <!-- aria-disabled, not disabled: disabling the focused button drops focus to <body>.
           useSignup().submit() ignores a submit while one is in flight. -->
      <button class="button" type="submit" :aria-disabled="submitting ? 'true' : undefined">
        {{ submitting ? 'Creating account…' : 'Create free account' }}
      </button>
    </div>
    <!-- role="alert": focus is usually already on the input, so re-focusing announces nothing. -->
    <p v-if="error" id="signup-email-error" class="field-error" role="alert">
      {{ error }}
    </p>
  </form>
</template>

<style scoped>
.signup-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
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

.button[aria-disabled='true'] {
  background: var(--btn-bg-primary-disabled);
  color: var(--btn-text-disabled);
  cursor: not-allowed;
}

@media (min-width: 640px) {
  .row {
    flex-direction: row;
  }

  .input {
    flex: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
</style>
