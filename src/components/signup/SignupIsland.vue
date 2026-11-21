<script setup lang="ts">
// The signup island: the hero CTA, and the native <dialog> it opens with the signup flow.
// showModal() gives focus containment, Esc and an inert page; this component adds focus on open,
// backdrop click, focus return, and blocks closing while a request is in flight.
import { useTemplateRef } from 'vue';
import { track } from '../../analytics/track';
import type { CtaLocation } from '../../analytics/taxonomy';
import { useFormStart } from '../../composables/useFormStart';
import { useSignup } from '../../composables/useSignup';
import EmailForm from './EmailForm.vue';
import MarketPicker from './MarketPicker.vue';

const props = defineProps<{ location: CtaLocation }>();

const cta = useTemplateRef<HTMLButtonElement>('cta');
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const emailForm = useTemplateRef<InstanceType<typeof EmailForm>>('emailForm');
const marketPicker = useTemplateRef<InstanceType<typeof MarketPicker>>('marketPicker');

const {
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
} = useSignup({
  onInvalid: () => focusEmail(),
  onSuccess: () => marketPicker.value?.focusHeading(),
});

// signup_form_start: the first interaction the USER causes in the email form, once per page view.
// Every focus() this component makes goes through focusEmail, so the guard can tell them apart.
const formStart = useFormStart(() => track('signup_form_start', {}));
function focusEmail() {
  formStart.focusFromCode(() => {
    emailForm.value?.focus();
    return document.activeElement;
  });
}
function onFormInteract(event: Event) {
  formStart.interact(event);
}
/** Enter on the auto-focused input causes no focusin or input: a submit is an interaction too. */
function onSubmit() {
  formStart.interact();
  void submit();
}

function onCtaClick() {
  track('cta_click', { cta_id: 'try_free', location: props.location });
  open();
}

function open() {
  const el = dialog.value;
  if (!el || el.open) return;
  el.showModal();
  track('signup_modal_open', { source: props.location });
  // After a success the email form is gone: the success heading takes focus instead.
  if (state.value.status === 'success') marketPicker.value?.focusHeading();
  else focusEmail();
}

/** Close button and backdrop. Ignored while a POST or PATCH is in flight. */
function requestClose() {
  if (busy.value) return;
  dialog.value?.close();
}

/** Esc. Cancelled while busy; a second Esc can still close it in Chrome (DECISIONS). */
function onCancel(event: Event) {
  if (busy.value) event.preventDefault();
}

/** Browsers restore focus on close too; doing it explicitly covers every close path. */
function onClose() {
  track('signup_modal_close', { step: step() });
  cta.value?.focus();
}

/** Retry disappears while submitting, so focus moves to the (readonly) email input first. */
function retry() {
  focusEmail();
  void submit();
}

// A click whose target is the <dialog> itself is on the backdrop: the panel fills the dialog's
// box. Both ends must be on the backdrop, so a text selection dragged out of the panel does not
// close it.
let pressedOnBackdrop = false;
function onPointerDown(event: PointerEvent) {
  pressedOnBackdrop = event.target === event.currentTarget;
}
function onDialogClick(event: MouseEvent) {
  if (pressedOnBackdrop && event.target === event.currentTarget) requestClose();
  pressedOnBackdrop = false;
}
</script>

<template>
  <div class="signup-island">
    <!-- Server-rendered: inert until hydration, which client:visible starts on load (above the fold). -->
    <button ref="cta" class="cta" type="button" aria-haspopup="dialog" @click="onCtaClick">
      Try FX Replay free
    </button>

    <dialog
      ref="dialog"
      class="signup-dialog"
      aria-labelledby="signup-dialog-title"
      @cancel="onCancel"
      @close="onClose"
      @pointerdown="onPointerDown"
      @click="onDialogClick"
    >
      <div class="panel">
        <div class="header">
          <h2 id="signup-dialog-title" class="title">Create your free account</h2>
          <button
            class="close"
            type="button"
            :aria-disabled="busy ? 'true' : undefined"
            @click="requestClose"
          >
            Close
          </button>
        </div>

        <EmailForm
          v-if="state.status !== 'success'"
          ref="emailForm"
          v-model:email="email"
          :submitting="state.status === 'submitting'"
          :error="emailError"
          @submit="onSubmit"
          @interact="onFormInteract"
        />
        <MarketPicker
          v-else
          ref="marketPicker"
          v-model="selectedMarket"
          :saving="state.market.status === 'saving'"
          @submit="saveMarket"
        />

        <div class="feedback">
          <p class="status" :class="{ 'is-error': isError }" role="status" aria-live="polite">
            {{ statusMessage }}
          </p>
          <button v-if="state.status === 'error'" class="retry" type="button" @click="retry">
            Retry
          </button>
        </div>
      </div>
    </dialog>
  </div>
</template>

<style>
/* Scroll lock while the modal is open. Unscoped: it targets the root element. */
html:has(.signup-dialog[open]) {
  overflow: hidden;
  /* Keeps the scrollbar's space, so the page does not shift sideways on desktop. */
  scrollbar-gutter: stable;
}
</style>

<style scoped>
.cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 12px 28px;
  border: 0;
  border-radius: 8px;
  background: var(--btn-bg-primary-active);
  color: var(--btn-text);
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1.0625rem;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.cta:hover {
  background: var(--btn-bg-primary-hover);
}

.cta:active {
  background: var(--btn-bg-primary-pressed);
}

/* 16px gutter on each side at any width; the panel scrolls if the viewport is short. */
.signup-dialog {
  width: min(560px, 100% - 32px);
  max-width: none;
  max-height: calc(100% - 32px);
  margin: auto;
  padding: 0;
  border: 1px solid var(--border-primary);
  border-radius: 12px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: var(--font-body);
  /* The panel scrolls, not the dialog: a press on a scrollbar must not count as the backdrop. */
  overflow: hidden;
}

.signup-dialog::backdrop {
  background: var(--card-bg-translucent);
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: calc(100dvh - 34px);
  padding: 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.title {
  color: var(--text-primary);
  font-size: 1.5rem;
}

.close {
  flex-shrink: 0;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--btn-border-outline);
  border-radius: 8px;
  background: var(--btn-bg-outline-active);
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.close:hover {
  background: var(--btn-bg-outline-hover);
}

.close:active {
  background: var(--btn-bg-outline-pressed);
}

.close[aria-disabled='true'] {
  background: var(--btn-bg-outline-disabled);
  color: var(--btn-text-disabled);
  cursor: not-allowed;
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

.retry {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 12px 28px;
  border: 0;
  border-radius: 8px;
  background: var(--btn-bg-secondary-active);
  color: var(--btn-text);
  font: inherit;
  font-weight: 700;
  font-size: 1.0625rem;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.retry:hover {
  background: var(--btn-bg-secondary-hover);
}

.retry:active {
  background: var(--btn-bg-secondary-pressed);
}

@media (min-width: 640px) {
  .panel {
    padding: 28px;
  }

  .title {
    font-size: 1.75rem;
  }
}

/* Open animation only when motion is welcome; closing is instant. */
@media (prefers-reduced-motion: no-preference) {
  .signup-dialog[open] {
    animation: dialog-in 160ms ease-out;
  }

  .signup-dialog[open]::backdrop {
    animation: backdrop-in 160ms ease-out;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cta,
  .close,
  .retry {
    transition: none;
  }
}

@keyframes dialog-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

@keyframes backdrop-in {
  from {
    opacity: 0;
  }
}
</style>
