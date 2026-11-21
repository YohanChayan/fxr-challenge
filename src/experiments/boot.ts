// The one inline <head> script — the single, documented exception to "zero JS outside islands"
// (docs/DECISIONS.md). BaseLayout serialises bootHead with Function#toString and runs it before
// first paint, so it must stay self-contained: no imports, no closures, no TS-only runtime syntax.
//
// It does two things, both by setting attributes on <html> that CSS reads:
//   data-variant  space-separated variant ids, e.g. "CONV-trust-line-v1-variant" (sticky cookie)
//   data-consent  'granted' | 'denied' | 'unset' — the consent banner shows only on 'unset'
import {
  EXPERIMENT_COOKIE_MAX_AGE,
  EXPERIMENT_COOKIE_PREFIX,
  experiments,
  variantId,
  type ExperimentId,
} from './flags';
import { CONSENT_COOKIE } from '../analytics/consent-cookie';

export type BootExperiment = { id: string; arms: { arm: string; weight: number; vid: string }[] };

export type BootConfig = {
  experiments: BootExperiment[];
  cookiePrefix: string;
  maxAge: number;
  consentCookie: string;
};

/** The minimal Document surface bootHead touches, so tests can pass a fake. */
export type BootDocument = {
  cookie: string;
  documentElement: { setAttribute(name: string, value: string): void };
  location?: { protocol: string };
};

export function bootHead(cfg: BootConfig, doc: BootDocument, random: () => number): void {
  function read(name: string): string | null {
    const parts = doc.cookie ? doc.cookie.split('; ') : [];
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=');
      if (parts[i].slice(0, eq) !== name) continue;
      try {
        return decodeURIComponent(parts[i].slice(eq + 1));
      } catch {
        return null; // malformed value: treated as absent, never a crash before first paint
      }
    }
    return null;
  }
  const secure = doc.location && doc.location.protocol === 'https:' ? '; Secure' : '';
  const ids: string[] = [];
  for (let e = 0; e < cfg.experiments.length; e++) {
    const exp = cfg.experiments[e];
    const name = cfg.cookiePrefix + exp.id;
    const stored = read(name);
    let chosen: BootExperiment['arms'][number] | null = null;
    for (let a = 0; a < exp.arms.length; a++) if (exp.arms[a].arm === stored) chosen = exp.arms[a];
    if (!chosen) {
      let total = 0;
      for (let a = 0; a < exp.arms.length; a++) total += exp.arms[a].weight;
      let pick = random() * total;
      chosen = exp.arms[exp.arms.length - 1];
      for (let a = 0; a < exp.arms.length; a++) {
        pick -= exp.arms[a].weight;
        if (pick < 0) {
          chosen = exp.arms[a];
          break;
        }
      }
      doc.cookie =
        name + '=' + chosen.arm + '; Max-Age=' + cfg.maxAge + '; Path=/; SameSite=Lax' + secure;
    }
    ids.push(chosen.vid);
  }
  doc.documentElement.setAttribute('data-variant', ids.join(' '));
  const consent = read(cfg.consentCookie);
  doc.documentElement.setAttribute(
    'data-consent',
    consent === 'granted' || consent === 'denied' ? consent : 'unset',
  );
}

/** The serialisable config, derived from the registry. */
export function bootConfig(): BootConfig {
  return {
    experiments: (Object.keys(experiments) as ExperimentId[]).map((id) => ({
      id,
      arms: experiments[id].variants.map((arm, i) => ({
        arm,
        weight: experiments[id].weights[i] ?? 0,
        vid: variantId(id, arm),
      })),
    })),
    cookiePrefix: EXPERIMENT_COOKIE_PREFIX,
    maxAge: EXPERIMENT_COOKIE_MAX_AGE,
    consentCookie: CONSENT_COOKIE,
  };
}

/** The inline script body BaseLayout emits. */
export function bootScript(): string {
  return `(${bootHead.toString()})(${JSON.stringify(bootConfig())},document,Math.random);`;
}
