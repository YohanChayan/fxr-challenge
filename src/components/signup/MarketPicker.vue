<script setup lang="ts">
// The success step: the focused success heading, then the market choice sent with PATCH.
// Presentational: state and save logic live in useSignup().
import { useTemplateRef } from 'vue';
import { MARKETS, type Market } from '../../lib/schemas/user';
import { MARKET_LABELS } from './markets';

defineProps<{ saving: boolean }>();
const selected = defineModel<Market | null>({ required: true });
const emit = defineEmits<{ submit: [] }>();

const heading = useTemplateRef<HTMLHeadingElement>('heading');
defineExpose({ focusHeading: () => heading.value?.focus() });
</script>

<template>
  <div class="success">
    <!-- h3: the dialog's own h2 ("Create your free account") is the level above. -->
    <h3 ref="heading" class="success-title" tabindex="-1">Your free account is ready</h3>
    <form class="market-form" novalidate @submit.prevent="emit('submit')">
      <!-- Not disabled while saving: disabling the focused control drops focus to <body>.
           saveMarket() ignores a second submit, and the button is aria-disabled instead. -->
      <fieldset class="fieldset">
        <legend class="legend">Which market do you want to replay first?</legend>
        <div class="options">
          <label v-for="market in MARKETS" :key="market" class="option">
            <input
              v-model="selected"
              class="radio"
              type="radio"
              name="preferred-market"
              :value="market"
            />
            {{ MARKET_LABELS[market] }}
          </label>
        </div>
      </fieldset>
      <button class="button" type="submit" :aria-disabled="saving ? 'true' : undefined">
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.success {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.success-title {
  color: var(--text-primary);
  font-size: clamp(1.5rem, 1.2rem + 1.2vw, 2rem);
}

.market-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.legend {
  color: var(--text-primary);
  font-weight: 700;
  font-size: 1rem;
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

@media (prefers-reduced-motion: reduce) {
  .button,
  .option {
    transition: none;
  }
}
</style>
