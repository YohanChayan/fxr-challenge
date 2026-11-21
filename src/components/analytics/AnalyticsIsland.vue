<script setup lang="ts">
// The analytics island: mounted once per page (BaseLayout, client:load). On mount it fires
// page_view and one experiment_exposure per assigned experiment (both arms), then starts GA4 if
// the visitor accepted earlier. It also renders the consent banner, which CSS shows only while
// <html data-consent="unset"> — set by the inline <head> script, so a returning visitor never
// sees it flash, and a visitor without JS never sees buttons that cannot work.
import { onMounted } from 'vue';
import { initConsent, setConsent } from '../../analytics/consent';
import type { ConsentChoice } from '../../analytics/consent-cookie';
import { pageViewProps } from '../../analytics/page-view';
import { track } from '../../analytics/track';
import { exposuresFrom } from '../../experiments/flags';

onMounted(() => {
  track('page_view', pageViewProps(new URL(location.href), document.referrer));
  for (const exposure of exposuresFrom(document.documentElement.dataset.variant)) {
    track('experiment_exposure', exposure);
  }
  initConsent();
});

function choose(choice: ConsentChoice) {
  setConsent(choice);
  // The focused button disappears with the banner: hand focus to the page instead of <body>.
  document.getElementById('main')?.focus({ preventScroll: true });
}
</script>

<template>
  <!-- A labelled region, not a heading: it sits before the page's h1 in the DOM. -->
  <section class="consent-banner" aria-labelledby="consent-title">
    <div class="consent-inner">
      <div class="consent-copy">
        <p id="consent-title" class="consent-title">Analytics cookies</p>
        <p class="consent-text">
          We'd like to use Google Analytics cookies to measure how this page performs. Nothing is
          sent to Google unless you accept.
        </p>
      </div>
      <div class="consent-actions">
        <button class="consent-button" type="button" @click="choose('denied')">Reject</button>
        <button class="consent-button" type="button" @click="choose('granted')">Accept</button>
      </div>
    </div>
  </section>
</template>

<style>
/* Unscoped: visibility depends on the root element's data-consent. */
.consent-banner {
  display: none;
}

html[data-consent='unset'] .consent-banner {
  display: block;
}

/* WCAG 2.4.11: the fixed banner must not hide the focused element. Measured banner heights
   (qa-a11y-perf): 216px at 320, 192px at 375 (column layout), 108px from 768 (row layout);
   about 10% headroom for text resizing. */
html[data-consent='unset'] {
  scroll-padding-bottom: 240px;
}

@media (min-width: 768px) {
  html[data-consent='unset'] {
    scroll-padding-bottom: 120px;
  }
}
</style>

<style scoped>
.consent-banner {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 20;
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-primary);
  color: var(--text-primary);
}

.consent-inner {
  max-width: 1120px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.consent-title {
  font-weight: 700;
  font-size: 1.0625rem;
}

.consent-text {
  color: var(--text-secondary);
  font-size: 0.9375rem;
  max-width: 65ch;
}

.consent-actions {
  display: flex;
  gap: 8px;
}

/* Accept and Reject look the same: neither choice is nudged. */
.consent-button {
  flex: 1;
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid var(--btn-border-outline);
  border-radius: 8px;
  background: var(--btn-bg-outline-active);
  color: var(--text-primary);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.consent-button:hover {
  background: var(--btn-bg-outline-hover);
}

.consent-button:active {
  background: var(--btn-bg-outline-pressed);
}

@media (min-width: 768px) {
  .consent-inner {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 16px 32px;
    gap: 24px;
  }

  .consent-button {
    flex: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .consent-button {
    transition: none;
  }
}
</style>
