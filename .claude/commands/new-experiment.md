---
description: Scaffold an A/B experiment — variant flag, experiment_exposure event, and a docs/experiments/<id>.md stub
argument-hint: <experiment_id> "<one-line hypothesis>"
---

Scaffold one A/B experiment. Arguments: `$ARGUMENTS`

Format: `<experiment_id> "<hypothesis>"`, where id is `kebab-case`, e.g.
`/new-experiment hero-cta-copy "Outcome-led CTA copy lifts signup start rate"`.

## Steps

1. **Validate.** Id is kebab-case and not already present in `src/experiments/flags.ts` or
   `docs/experiments/`. If it exists, show it and stop.

2. **Variant flag** — add the experiment to `src/experiments/flags.ts`. If the file does not
   exist, create it in this shape:

   ```ts
   // Experiment registry. Assignment is deterministic per anonymous id, so a visitor always
   // sees the same variant, and it happens server-side or in the first inline script to avoid
   // flicker and CLS.
   export const experiments = {
     'hero-cta-copy': { variants: ['control', 'variant'] as const, weights: [50, 50] },
   } as const;

   export type ExperimentId = keyof typeof experiments;
   export type Variant<E extends ExperimentId> = (typeof experiments)[E]['variants'][number];
   ```

   Default to two arms, 50/50, unless the arguments say otherwise.

3. **Exposure event** — if `experiment_exposure` is not in `src/analytics/taxonomy.ts`, run the
   `/add-event` flow for it:
   `experiment_exposure "user is shown an experiment variant (once per experiment per session)" experiment_id:string variant:string`
   Exposure fires when the variant is actually **rendered in view**, not when it is assigned, and
   at most once per experiment per session. Analysis joins exposure to the conversion event.

4. **Doc stub** — create `docs/experiments/<id>.md` with exactly these headings, filling only
   what the arguments state and leaving the rest as `TODO`:

   ```md
   # Experiment: <id>

   Status: draft

   ## Hypothesis

   ## Control

   ## Variant

   ## Primary success metric

   ## Guardrail metrics

   ## Sample size and duration

   ## Decision

   ### Ship the variant if

   ### Continue the experiment if

   ### Reject the variant if
   ```

5. Link the new file from `docs/EXPERIMENT.md` under its list of experiments.

6. Run `npm run typecheck` and report the result.

## Must NOT

- Render either variant in components — wiring the variant into the UI is implementer work.
- Invent numbers (baseline rate, MDE, sample size). Leave `TODO` unless given.
