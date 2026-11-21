// Single source of truth for analytics events. track() is typed from this object, so an unknown
// event or a wrong property is a type error. Add events with /add-event.
//
// Every event also carries event_id, session_id and variant, attached centrally by track() —
// never at call sites. No property may hold an email, a name, users.id, an IP or free text.
import type { Market } from '../lib/schemas/user';

/** Where a "Try FX Replay free" CTA sits on the page. */
export type CtaLocation = 'hero';

/**
 * Where the signup dialog was in its flow when it closed. `email` = no POST sent yet (drop-off
 * before submit); `rejected` = back on the email step after any POST was sent that did not succeed.
 */
export type SignupStep = 'email' | 'rejected' | 'submitting' | 'error' | 'market' | 'done';

export type FieldErrorCode = 'required' | 'invalid_format' | 'too_long' | 'email_taken';

export type SignupFailureReason =
  'email_taken' | 'invalid_email' | 'rate_limited' | 'network' | 'unexpected';

/** Empty props: track('x', {}) — and any property passed is a type error. */
type NoProps = Record<string, never>;

export const taxonomy = {
  page_view: {
    trigger: 'The landing page is loaded (once per page load, from the analytics island)',
    funnel: '1 — entry',
    // utm_* are marketer-set campaign slugs: dropped unless <= 100 chars of [A-Za-z0-9._-]
    // with fewer than 7 digits (page-view.ts), so no email, phone, name or free text. referrer is the referring origin only (no path or query), or '' if none.
    props: {} as {
      utm_source?: string;
      utm_medium?: string;
      utm_campaign?: string;
      utm_term?: string;
      utm_content?: string;
      referrer: string;
    },
  },
  experiment_exposure: {
    trigger: 'The page rendered an experiment arm (once per experiment per page view, both arms)',
    funnel: '—',
    // variant_id follows Convert's naming: CONV-<experiment_id>-<arm>.
    props: {} as { experiment_id: string; variant_id: string },
  },
  cta_click: {
    trigger: 'User clicks a "Try FX Replay free" CTA',
    funnel: '2 — intent',
    props: {} as { cta_id: 'try_free'; location: CtaLocation },
  },
  signup_modal_open: {
    trigger: 'The signup dialog opens (after showModal)',
    funnel: '3 — modal open',
    props: {} as { source: CtaLocation },
  },
  signup_form_start: {
    trigger:
      'First user interaction inside the email form: a focus the user caused, typing, or a ' +
      'submit (once per page view; the automatic focus on open does not count)',
    funnel: '4 — form start',
    props: {} as NoProps,
  },
  signup_field_error: {
    trigger: 'A field error is shown: client validation on submit, or a 409/422 from the API',
    funnel: '—',
    props: {} as { field: 'email'; code: FieldErrorCode },
  },
  signup_submit: {
    trigger: 'Client validation passed and POST /api/users is sent (each attempt, incl. Retry)',
    funnel: '5 — submit',
    props: {} as NoProps,
  },
  sign_up: {
    trigger: 'POST /api/users returned 201 (GA4 recommended event) — never on submit',
    funnel: '6 — conversion',
    props: {} as { method: 'email' },
  },
  signup_failure: {
    trigger:
      'A sent POST /api/users did not return 201. Every signup_submit ends in exactly one ' +
      'sign_up or signup_failure',
    funnel: '—',
    props: {} as { reason: SignupFailureReason },
  },
  signup_modal_close: {
    trigger: 'The signup dialog closes, by any path (Close, Esc, backdrop)',
    funnel: '— (step "email" = drop-off before submit)',
    props: {} as { step: SignupStep },
  },
  market_selected: {
    trigger: 'PATCH /api/users/:id saved the preferred market (200)',
    funnel: '7 — activation',
    props: {} as { market: Market },
  },
} as const;

export type EventName = keyof typeof taxonomy;
export type EventProps<E extends EventName> = (typeof taxonomy)[E]['props'];

/** What track() adds to every event. */
export type EventContext = {
  /** A fresh v4 uuid per event, for deduplication downstream. */
  event_id: string;
  /** Opaque, per browser tab (sessionStorage). Not users.id and not GA4's own session id. */
  session_id: string;
  /** Space-separated experiment variant ids from <html data-variant>, or 'none'. */
  variant: string;
};
