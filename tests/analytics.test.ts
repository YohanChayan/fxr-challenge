import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageViewProps, referrerOrigin, sanitizedPageLocation } from '../src/analytics/page-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('page_view properties', () => {
  it('keeps utm_* and the referring origin only', () => {
    const url = new URL(
      'https://x.test/?utm_source=google&utm_medium=cpc&utm_campaign=%20spring_sale%20&gclid=abc',
    );
    expect(pageViewProps(url, 'https://www.google.com/search?q=secret')).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring_sale',
      referrer: 'https://www.google.com',
    });
  });

  it.each(['+15551234567', '555-123-4567', 'Jane Doe', 'jane%20doe', 'call me?'])(
    'drops the free-text utm_term %j',
    (term) => {
      const url = new URL(`https://x.test/?utm_term=${term}&utm_source=google`);
      expect(pageViewProps(url, '')).toEqual({ utm_source: 'google', referrer: '' });
    },
  );

  it('drops utm values outside the slug allowlist or over 100 characters', () => {
    const url = new URL(
      `https://x.test/?utm_content=ann%40x.com&utm_term=${'a'.repeat(101)}` +
        '&utm_medium=https%3A%2F%2Fx.test&utm_source=call%20me%3F&utm_campaign=Spring_Sale-2026',
    );
    expect(pageViewProps(url, '')).toEqual({ utm_campaign: 'Spring_Sale-2026', referrer: '' });
  });

  it('maps a missing or invalid referrer to an empty string', () => {
    expect(referrerOrigin('')).toBe('');
    expect(referrerOrigin('not a url')).toBe('');
  });

  it('sends GA4 a page_location without non-utm query params', () => {
    const url = new URL('https://x.test/path?email=ann%40x.com&utm_source=fb#top');
    expect(sanitizedPageLocation(url)).toBe('https://x.test/path?utm_source=fb');
  });
});

type FakeWindow = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };

/** The browser surface track.ts and consent.ts touch, on a fresh module graph per test. */
function stubBrowser({ variant = 'CONV-trust-line-v1-variant', consent = 'unset' } = {}) {
  const win: FakeWindow = {};
  const dataset: Record<string, string> = { variant, consent };
  const appended: { src: string; async: boolean }[] = [];
  const storage = new Map<string, string>();
  const doc = {
    cookie: '',
    referrer: 'https://ref.test/path?email=ann%40x.com',
    documentElement: { dataset },
    head: { append: (el: { src: string; async: boolean }) => appended.push(el) },
    createElement: () => ({ src: '', async: false }),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { href: 'https://x.test/?utm_source=a&email=b', protocol: 'https:' });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  return { win, doc, dataset, appended, storage };
}

async function load() {
  const track = await import('../src/analytics/track');
  const consent = await import('../src/analytics/consent');
  return { ...track, ...consent };
}

/** gtag() pushes Arguments objects; turn them into arrays to compare. */
function gtagCalls(win: FakeWindow) {
  return (win.dataLayer ?? [])
    .filter((e) => Object.prototype.toString.call(e) === '[object Arguments]')
    .map((e) => Array.from(e as ArrayLike<unknown>));
}

describe('track()', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('pushes the event to dataLayer with event_id, session_id and variant', async () => {
    const { win, storage } = stubBrowser();
    const { track } = await load();
    track('cta_click', { cta_id: 'try_free', location: 'hero' });
    track('signup_submit', {});

    const [first, second] = win.dataLayer as Record<string, unknown>[];
    expect(first).toMatchObject({
      event: 'cta_click',
      cta_id: 'try_free',
      location: 'hero',
      variant: 'CONV-trust-line-v1-variant',
    });
    expect(first?.event_id).toMatch(UUID);
    expect(first?.session_id).toMatch(UUID);
    expect(second?.event_id).not.toBe(first?.event_id);
    expect(second?.session_id).toBe(first?.session_id);
    expect(storage.get('fxr_sid')).toBe(first?.session_id);
  });

  it("reports variant 'none' when nothing was assigned", async () => {
    const { win } = stubBrowser({ variant: '' });
    const { track } = await load();
    track('signup_submit', {});
    expect(win.dataLayer?.[0]).toMatchObject({ variant: 'none' });
  });

  it('is a no-op on the server', async () => {
    const { track } = await load();
    expect(() => track('signup_submit', {})).not.toThrow();
  });

  it('sends nothing to GA4 before consent; replays the page view on Accept', async () => {
    const { win, appended } = stubBrowser();
    const { track, setConsent } = await load();
    track('page_view', { referrer: '' });
    expect(win.gtag).toBeUndefined();
    expect(appended).toEqual([]);

    setConsent('granted', 'G-TEST123');
    track('cta_click', { cta_id: 'try_free', location: 'hero' });

    const calls = gtagCalls(win);
    expect(calls.slice(0, 4).map((c) => c[0])).toEqual(['consent', 'consent', 'js', 'config']);
    expect(calls[0]).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
      },
    ]);
    expect(calls[1]).toEqual(['consent', 'update', { analytics_storage: 'granted' }]);
    expect(calls[3]?.[2]).toMatchObject({
      send_page_view: false,
      page_location: 'https://x.test/?utm_source=a',
      page_referrer: 'https://ref.test',
    });
    const events = calls.filter((c) => c[0] === 'event');
    expect(events.map((c) => c[1])).toEqual(['page_view', 'cta_click']);
    // GA4 gets fxr_session_id, never a param named session_id.
    expect(events[0]?.[2]).toHaveProperty('fxr_session_id');
    expect(events[0]?.[2]).not.toHaveProperty('session_id');
    expect(appended).toEqual([
      { src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST123', async: true },
    ]);
  });

  it('Reject stores the choice, loads nothing, and drops the buffer', async () => {
    const { win, doc, dataset, appended } = stubBrowser();
    const { track, setConsent, enableGa } = await load();
    track('page_view', { referrer: '' });
    setConsent('denied', 'G-TEST123');
    expect(doc.cookie).toMatch(
      /^fxr_consent=denied; Max-Age=15552000; Path=\/; SameSite=Lax; Secure$/,
    );
    expect(dataset.consent).toBe('denied');
    expect(win.gtag).toBeUndefined();
    expect(appended).toEqual([]);
    win.gtag = vi.fn();
    enableGa();
    expect(win.gtag).not.toHaveBeenCalled();
  });

  it('a returning visitor who accepted gets GA4 on load; one who rejected does not', async () => {
    const granted = stubBrowser({ consent: 'granted' });
    (await load()).initConsent('G-TEST123');
    expect(granted.appended).toHaveLength(1);

    vi.resetModules();
    const denied = stubBrowser({ consent: 'denied' });
    (await load()).initConsent('G-TEST123');
    expect(denied.appended).toEqual([]);
  });

  it('never loads gtag.js without a valid measurement id', async () => {
    const { win, appended } = stubBrowser();
    const { setConsent } = await load();
    setConsent('granted', '');
    setConsent('granted', 'UA-123');
    expect(win.gtag).toBeUndefined();
    expect(appended).toEqual([]);
  });
});

describe('signup_form_start guard', () => {
  async function guard() {
    const { useFormStart } = await import('../src/composables/useFormStart');
    const onStart = vi.fn();
    return { ...useFormStart(onStart), onStart };
  }
  const input = { name: 'input' };
  const button = { name: 'button' };

  it('ignores the focusin our own focus() dispatches, then counts typing once', async () => {
    const g = await guard();
    g.focusFromCode(() => {
      g.interact({ type: 'focusin', target: input, relatedTarget: null });
      return input;
    });
    expect(g.onStart).not.toHaveBeenCalled();
    g.interact({ type: 'input', target: input });
    g.interact({ type: 'input', target: input });
    expect(g.onStart).toHaveBeenCalledTimes(1);
  });

  it('ignores focus restored to the auto-focused input after a tab switch', async () => {
    const g = await guard();
    g.focusFromCode(() => input);
    g.interact({ type: 'focusin', target: input, relatedTarget: null });
    expect(g.onStart).not.toHaveBeenCalled();
  });

  it('counts a focus the user moves (Tab to the button, or back into the input)', async () => {
    const g = await guard();
    g.focusFromCode(() => input);
    g.interact({ type: 'focusin', target: button, relatedTarget: input });
    expect(g.onStart).toHaveBeenCalledTimes(1);

    const h = await guard();
    h.focusFromCode(() => input);
    h.interact({ type: 'focusin', target: input, relatedTarget: button });
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it('counts a submit (Enter on the auto-focused input)', async () => {
    const g = await guard();
    g.focusFromCode(() => input);
    g.interact();
    expect(g.onStart).toHaveBeenCalledTimes(1);
  });
});
