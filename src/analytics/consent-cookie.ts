// Consent cookie constants, shared by the inline <head> script (boot.ts) and consent.ts.
// A strictly necessary cookie: it only records the visitor's Accept / Reject choice.
export const CONSENT_COOKIE = 'fxr_consent';
/** 180 days, then the banner asks again. */
export const CONSENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

export type ConsentChoice = 'granted' | 'denied';
