// The typed track(). Every event goes to window.dataLayer immediately, with its context attached
// here (never at call sites). GA4 receives it only after consent: events tracked earlier in this
// page view are held in memory and replayed when GA4 is enabled, so page_view and
// experiment_exposure are not lost to the banner. Nothing is stored or sent before that.
import type { EventContext, EventName, EventProps } from './taxonomy';

const SESSION_KEY = 'fxr_sid';
/** A cap on the pre-consent buffer; one page view produces far fewer events. */
const MAX_PENDING = 100;

type Params = Record<string, unknown> & EventContext;

let sessionId: string | undefined;
let gaEnabled = false;
let pending: { event: EventName; params: Params }[] = [];

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID needs a secure context; plain http on a LAN address falls back to this.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Per browser tab: sessionStorage, or per page if storage is blocked. */
function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY) ?? undefined;
    if (!sessionId) {
      sessionId = uuid();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch {
    sessionId ??= uuid();
  }
  return sessionId;
}

function context(): EventContext {
  return {
    event_id: uuid(),
    session_id: getSessionId(),
    variant: document.documentElement.dataset.variant || 'none',
  };
}

/**
 * GA4 owns a field called session_id (gtag('get', id, 'session_id')), so ours is renamed for
 * GA4 only, rather than risk it overriding GA4's sessionisation.
 */
function toGa({ session_id, ...rest }: Params): Record<string, unknown> {
  return { ...rest, fxr_session_id: session_id };
}

export function track<E extends EventName>(event: E, props: EventProps<E>): void {
  if (typeof window === 'undefined') return;
  const params: Params = { ...props, ...context() };
  (window.dataLayer ??= []).push({ event, ...params });
  if (gaEnabled) window.gtag?.('event', event, toGa(params));
  else if (pending.length < MAX_PENDING) pending.push({ event, params });
}

/** Called once gtag is defined and consent granted: replays this page view's earlier events. */
export function enableGa(): void {
  if (gaEnabled) return;
  gaEnabled = true;
  for (const { event, params } of pending) window.gtag?.('event', event, toGa(params));
  pending = [];
}

/** The visitor rejected analytics: the buffered events are discarded. */
export function discardPending(): void {
  pending = [];
}
