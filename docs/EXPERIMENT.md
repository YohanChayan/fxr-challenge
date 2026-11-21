# Experiment: "No credit card required" under the CTA

## Hypothesis
Placing "No credit card required" directly under the primary CTA reinforces trust at the moment of intent. It removes the fear of being charged and makes the "free" in the CTA credible, so more visitors click it and complete signup.
**We'll know it worked when** the visitor-to-sign_up rate is higher in the variant, with no guardrail harmed.

## Control
Current landing. The CTA reads "Try FX Replay free"; no trust line.

## Variant
Same page plus "No credit card required" directly under the hero CTA. Nothing else changes.

## Assignment
- 50/50, sticky per visitor (first-party cookie).
- Assigned by a tiny inline `<head>` script before first paint, so there is no flicker.
- `experiment_exposure {experiment_id, variant_id}` fires once per page view in both arms, named
  like Convert (`CONV-trust-line-v1-<variant>`).

## Success metric
**Primary:** unique visitors with `sign_up` ÷ unique visitors with `experiment_exposure`, per variant.
`sign_up` fires only after the API returns 201.

**Guardrails** (must not get worse):
- LCP / CLS on the landing.
- Signup error rate (`signup_field_error` + `signup_failure` per `signup_submit`).
- Signup quality: share of new users who complete `market_selected`.

## Sample size and duration
| Assumption | Value |
|---|---|
| Baseline conversion | 3% (assumed; replace with real GA4 data) |
| Minimum detectable effect | +15% relative (3.0% → 3.45%) |
| Significance / power | 95% / 80%, two-sided |
| Required sample | ~24,200 visitors per arm (~48,400 total) |
| Assumed traffic | 2,500 visitors/day |
| Duration | 19.4 days → **3 full weeks** (full weeks cover weekday/weekend cycles) |

Trade-off: stopping at 2 weeks (17,500 per arm) could only detect ≥ +18%, which is optimistic for a
one-line copy change.

## Decision rules
**Before reading results:** run a sample-ratio-mismatch (SRM) check (chi-square on exposures; p < 0.01
→ the split is broken; investigate, don't trust the result).

- **Ship:** full sample reached, variant significantly better on the primary metric, no guardrail worse.
- **Continue:** the full sample isn't reached yet. No peeking: interim looks don't decide anything.
- **Reject:** variant significantly worse, a guardrail breaks, or the result is flat at full sample.
  Keep the control.

## Data quality
- Assignment happens before and independently of consent, so both arms lose the same share of
  non-consenting visitors. The measured population is consenting visitors only.
- Daily reconciliation: GA4 `sign_up` count vs. rows created in the database.
- `event_id` dedupe. Internal traffic and bots excluded. QA in GA4 DebugView on a separate property.

## Risks
- **The modal adds a step.** The CTA opens a modal instead of an inline form, which may cost intent
  before the trust line can help. This is the next experiment (below).
- **The effect may be too small to detect** at realistic traffic. A flat result is still a decision:
  keep the control and test something bigger.

## Next experiments (backlog)
1. **Inline form in the hero vs. modal** (next, whatever the outcome of trust-line-v1).
   Hypothesis: removing the extra step keeps visitors at their peak intent, so more of them complete signup. Measured on the same primary metric; the funnel shows where the modal loses people:
   `cta_click` → `signup_modal_open` → `signup_form_start` → `sign_up`.
   If trust-line-v1 ships, both arms include the trust line, so only one thing changes.
2. **Measure conversion without consent:** store the variant on the user row (not PII), so
   conversions can be counted from the database too.