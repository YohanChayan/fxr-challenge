// Experiment registry. Assignment is random per browser and sticky (one cookie per experiment).
// It happens in the inline <head> script (src/experiments/boot.ts), before first paint, so CSS can
// show the right arm with no flicker and no CLS.
export const experiments = {
  'trust-line-v1': { variants: ['control', 'variant'] as const, weights: [50, 50] },
} as const;

export type ExperimentId = keyof typeof experiments;
export type Variant<E extends ExperimentId> = (typeof experiments)[E]['variants'][number];

/** Convert-style variant id: CONV-<experiment>-<arm>. Also the token in <html data-variant>. */
export function variantId<E extends ExperimentId>(experiment: E, arm: Variant<E>): string {
  return `CONV-${experiment}-${arm}`;
}

export const EXPERIMENT_COOKIE_PREFIX = 'fxr_exp_';
/** 90 days: longer than any test should run. */
export const EXPERIMENT_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

export type Exposure = { experiment_id: ExperimentId; variant_id: string };

/** The exposures encoded in <html data-variant>, in registry order; unknown tokens are ignored. */
export function exposuresFrom(dataVariant: string | undefined): Exposure[] {
  const tokens = new Set((dataVariant ?? '').split(/\s+/).filter(Boolean));
  const result: Exposure[] = [];
  for (const id of Object.keys(experiments) as ExperimentId[]) {
    for (const arm of experiments[id].variants) {
      const vid = variantId(id, arm);
      if (tokens.has(vid)) result.push({ experiment_id: id, variant_id: vid });
    }
  }
  return result;
}
