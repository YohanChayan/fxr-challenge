// page_view properties and the URL sent to GA4, stripped of anything that could carry PII.
import type { EventProps } from './taxonomy';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;
const UTM_MAX_LENGTH = 100;

/**
 * Campaign tags are slugs (spring_sale, google, cpc). Anything else is dropped, not cleaned:
 * utm_term can carry a searcher's own words, and no free text may reach analytics. No spaces
 * (names, queries), no '@' (emails), no '+' and never 7+ digits (phone numbers).
 */
const UTM_ALLOWED = /^[A-Za-z0-9._-]+$/;
const PHONE_LIKE = /(?:\d\D*){7}/;

/** A campaign tag, or undefined if missing, too long, or not a plain slug. */
function cleanUtm(value: string | null): string | undefined {
  const v = value?.trim();
  if (!v || v.length > UTM_MAX_LENGTH || !UTM_ALLOWED.test(v) || PHONE_LIKE.test(v)) {
    return undefined;
  }
  return v;
}

/** The referring origin only, never its path or query. '' when there is none. */
export function referrerOrigin(referrer: string): string {
  try {
    return referrer ? new URL(referrer).origin : '';
  } catch {
    return '';
  }
}

export function pageViewProps(url: URL, referrer: string): EventProps<'page_view'> {
  const props: EventProps<'page_view'> = { referrer: referrerOrigin(referrer) };
  for (const key of UTM_KEYS) {
    const value = cleanUtm(url.searchParams.get(key));
    if (value) props[key] = value;
  }
  return props;
}

/** GA4's page_location: origin + path + cleaned utm_* only. Other query params are dropped. */
export function sanitizedPageLocation(url: URL): string {
  const clean = new URL(url.origin + url.pathname);
  for (const key of UTM_KEYS) {
    const value = cleanUtm(url.searchParams.get(key));
    if (value) clean.searchParams.set(key, value);
  }
  return clean.href;
}
