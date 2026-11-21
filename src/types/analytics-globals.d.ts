// Browser globals used by src/analytics/. Type-only.
export {};

declare global {
  interface Window {
    /** Every track() call is pushed here; gtag() commands too, once consent is granted. */
    dataLayer?: unknown[];
    /** Defined only after the visitor accepts analytics (src/analytics/consent.ts). */
    gtag?: (...args: unknown[]) => void;
  }

  interface ImportMetaEnv {
    /** GA4 measurement id (G-XXXXXXXXXX). Public, inlined at build time. Unset = no GA4. */
    readonly PUBLIC_GA4_ID?: string;
  }
}
