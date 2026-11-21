// Consent and the GA4 loader. gtag.js is requested ONLY after the visitor accepts, now or on an
// earlier visit. Consent Mode v2 defaults are all 'denied'; Accept grants analytics_storage only
// (no ads). Reject stores the choice and loads nothing.
import { CONSENT_COOKIE, CONSENT_COOKIE_MAX_AGE, type ConsentChoice } from './consent-cookie';
import { referrerOrigin, sanitizedPageLocation } from './page-view';
import { discardPending, enableGa } from './track';

const GA4_ID_PATTERN = /^G-[A-Z0-9]+$/;

/** The stored choice, as the inline <head> script exposed it on <html data-consent>. */
export function storedConsent(): ConsentChoice | null {
  const value = document.documentElement.dataset.consent;
  return value === 'granted' || value === 'denied' ? value : null;
}

function startGa(measurementId: string): void {
  if (window.gtag) {
    // Already loaded (another snippet, or a second call): still replay the buffer, once.
    enableGa();
    return;
  }
  const dataLayer = (window.dataLayer ??= []);
  // gtag.js reads Arguments objects from the dataLayer, not arrays: this is Google's stub.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
  const gtag = window.gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
  gtag('consent', 'update', { analytics_storage: 'granted' });
  gtag('js', new Date());
  gtag('config', measurementId, {
    // page_view is ours (taxonomy), so GA4's automatic one would double-count it.
    send_page_view: false,
    page_location: sanitizedPageLocation(new URL(location.href)),
    // gtag would otherwise send document.referrer whole, path and query included.
    page_referrer: referrerOrigin(document.referrer),
    ...(import.meta.env.DEV ? { debug_mode: true } : {}),
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);

  enableGa();
}

/** On load: a visitor who accepted earlier gets GA4 without seeing the banner again. */
export function initConsent(measurementId = import.meta.env.PUBLIC_GA4_ID): void {
  const choice = storedConsent();
  if (choice === 'granted' && measurementId && GA4_ID_PATTERN.test(measurementId)) {
    startGa(measurementId);
  }
}

/** Accept / Reject from the banner. Updates <html data-consent>, which hides the banner (CSS). */
export function setConsent(
  choice: ConsentChoice,
  measurementId = import.meta.env.PUBLIC_GA4_ID,
): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
  document.documentElement.dataset.consent = choice;
  if (choice === 'denied') {
    discardPending();
    return;
  }
  if (measurementId && GA4_ID_PATTERN.test(measurementId)) startGa(measurementId);
}
