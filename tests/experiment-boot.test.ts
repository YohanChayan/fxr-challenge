import { describe, expect, it } from 'vitest';
import { bootConfig, bootHead, bootScript, type BootDocument } from '../src/experiments/boot';
import { experiments, exposuresFrom, variantId } from '../src/experiments/flags';

/** A document whose cookie setter appends, like the browser's (enough for one cookie per name). */
function fakeDoc(initialCookie = '', protocol = 'https:') {
  const attrs: Record<string, string> = {};
  const written: string[] = [];
  let jar = initialCookie;
  const doc: BootDocument = {
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      written.push(value);
      const pair = value.split(';')[0] ?? '';
      jar = jar ? `${jar}; ${pair}` : pair;
    },
    documentElement: { setAttribute: (name, value) => (attrs[name] = value) },
    location: { protocol },
  };
  return { doc, attrs, written };
}

const CONTROL = 'CONV-trust-line-v1-control';
const VARIANT = 'CONV-trust-line-v1-variant';

describe('flags', () => {
  it('registers trust-line-v1 as a 50/50 control/variant test', () => {
    expect(experiments['trust-line-v1']).toEqual({
      variants: ['control', 'variant'],
      weights: [50, 50],
    });
  });

  it('names variants like Convert', () => {
    expect(variantId('trust-line-v1', 'variant')).toBe(VARIANT);
  });

  it('reads exposures from data-variant and ignores unknown tokens', () => {
    expect(exposuresFrom(`${VARIANT} CONV-gone-x`)).toEqual([
      { experiment_id: 'trust-line-v1', variant_id: VARIANT },
    ]);
    expect(exposuresFrom(undefined)).toEqual([]);
    expect(exposuresFrom('')).toEqual([]);
  });
});

describe('bootHead', () => {
  it.each([
    [0, CONTROL],
    [0.4999, CONTROL],
    [0.5, VARIANT],
    [0.9999, VARIANT],
  ])('random %s assigns %s and stores it in a cookie', (r, expected) => {
    const { doc, attrs, written } = fakeDoc();
    bootHead(bootConfig(), doc, () => r);
    expect(attrs['data-variant']).toBe(expected);
    expect(written).toEqual([
      `fxr_exp_trust-line-v1=${expected === CONTROL ? 'control' : 'variant'}; Max-Age=7776000; Path=/; SameSite=Lax; Secure`,
    ]);
  });

  it('is sticky: a stored arm is reused and no cookie is rewritten', () => {
    const { doc, attrs, written } = fakeDoc('a=1; fxr_exp_trust-line-v1=variant');
    bootHead(bootConfig(), doc, () => 0);
    expect(attrs['data-variant']).toBe(VARIANT);
    expect(written).toEqual([]);
  });

  it('reassigns when the stored arm is unknown or malformed', () => {
    for (const cookie of ['fxr_exp_trust-line-v1=gone', 'fxr_exp_trust-line-v1=%E0%A4%A']) {
      const { doc, attrs, written } = fakeDoc(cookie);
      bootHead(bootConfig(), doc, () => 0);
      expect(attrs['data-variant']).toBe(CONTROL);
      expect(written).toHaveLength(1);
    }
  });

  it('omits Secure on plain http (localhost)', () => {
    const { doc, written } = fakeDoc('', 'http:');
    bootHead(bootConfig(), doc, () => 0);
    expect(written[0]).not.toContain('Secure');
  });

  it.each([
    ['', 'unset'],
    ['fxr_consent=granted', 'granted'],
    ['fxr_consent=denied', 'denied'],
    ['fxr_consent=maybe', 'unset'],
  ])('cookie %j sets data-consent=%s', (cookie, expected) => {
    const { doc, attrs } = fakeDoc(cookie);
    bootHead(bootConfig(), doc, () => 0);
    expect(attrs['data-consent']).toBe(expected);
  });

  it('serialises to a self-contained script that runs on its own', () => {
    const { doc, attrs } = fakeDoc();
    // Runs the exact string BaseLayout inlines, with only `document` and `Math` in scope.
    new Function('document', 'Math', bootScript())(doc, { random: () => 0.75 });
    expect(attrs['data-variant']).toBe(VARIANT);
    expect(attrs['data-consent']).toBe('unset');
  });
});
