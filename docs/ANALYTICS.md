# Analytics plan

The event catalogue is `src/analytics/taxonomy.ts`. `track()` (`src/analytics/track.ts`) is
typed from it, so an unknown event or a wrong property does not compile. This file describes it;
when they disagree, the code wins.

## Events

| Event                 | Trigger                                                                                                                     | Properties                                                                             | Funnel step    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------- |
| `page_view`           | The landing page loads (analytics island mount, once per page load)                                                         | `utm_source?`, `utm_medium?`, `utm_campaign?`, `utm_term?`, `utm_content?`, `referrer` | 1 — entry      |
| `experiment_exposure` | The page rendered an experiment arm: once per experiment per page view, **both arms**                                       | `experiment_id`, `variant_id` (`CONV-<exp>-<arm>`)                                     | —              |
| `cta_click`           | The user clicks a "Try FX Replay free" CTA                                                                                  | `cta_id: 'try_free'`, `location: 'hero'`                                               | 2 — intent     |
| `signup_modal_open`   | The signup dialog opens (after `showModal()`)                                                                               | `source: 'hero'`                                                                       | 3 — modal open |
| `signup_form_start`   | First user-caused focus, typing or submit in the email form, once per page view. The automatic focus on open does not count | —                                                                                      | 4 — form start |
| `signup_field_error`  | A field error is shown: client validation, or a 409/422 from the API                                                        | `field: 'email'`, `code`                                                               | —              |
| `signup_submit`       | Client validation passed and `POST /api/users` is sent: each attempt, Retry included                                        | —                                                                                      | 5 — submit     |
| `sign_up`             | `POST /api/users` returned **201**. Never on submit                                                                         | `method: 'email'`                                                                      | 6 — conversion |
| `signup_failure`      | A sent `POST` did not return 201                                                                                            | `reason`                                                                               | —              |
| `signup_modal_close`  | The dialog closes by any path (Close, Esc, backdrop)                                                                        | `step`                                                                                 | — (drop-off)   |
| `market_selected`     | `PATCH /api/users/:id` saved the preferred market (200)                                                                     | `market`                                                                               | 7 — activation |

Invariant: every `signup_submit` is followed by exactly one `sign_up` or `signup_failure`.

## Properties

### Event properties

| Property             | Values                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `utm_*`              | Campaign slugs from the URL, trimmed. Dropped unless at most 100 characters of `[A-Za-z0-9._-]` with fewer than 7 digits: no email, phone, name, URL or free text                                 |
| `referrer`           | The referring **origin** only (`https://www.google.com`), or `''`. Never its path or query                                                                                                        |
| `code` (field error) | `required` · `invalid_format` · `too_long` · `email_taken`                                                                                                                                        |
| `reason` (failure)   | `email_taken` (409) · `invalid_email` (422; its field-error `code` is always `invalid_format`, even for a too-long address) · `rate_limited` (429) · `network` · `unexpected`                     |
| `step` (modal close) | `email` (no POST sent yet: **drop-off before submit**) · `rejected` (back on the email step after a failed POST) · `submitting` · `error` · `market` (account created, market not saved) · `done` |
| `market`             | `forex` · `crypto` · `stocks` · `indices` · `futures`                                                                                                                                             |

### User / session context

`track()` attaches these to every event. Call sites never pass them:

| Property     | What it is                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `event_id`   | A fresh v4 uuid per event, for deduplication downstream                                                                              |
| `session_id` | An opaque v4 uuid per browser tab (`sessionStorage`, key `fxr_sid`); per page if storage is blocked. Sent to GA4 as `fxr_session_id` |
| `variant`    | The space-separated variant ids from `<html data-variant>`, e.g. `CONV-trust-line-v1-variant`; `none` if unassigned                  |

**No PII.** No event carries an email, a name, an IP or free text, and no event carries
`users.id`: that id authorises `PATCH` (`DECISIONS.md`). No user id is set in GA4.

## Funnel

### Funnel entry

`page_view`, segmented by `utm_*`, `referrer` and `variant`.

### Intermediate steps

`cta_click` → `signup_modal_open` → `signup_form_start` → `signup_submit`. Drop-off before
submit is `signup_modal_close` with `step: 'email'`. Drop-off after a failed submit is
`rejected` or `error`, and `signup_field_error` and `signup_failure` (`code`, `reason`) show
why. `market_selected` fires on every successful save, so a re-save fires it again. Count
activation per session, and the last value wins.

### Primary conversion event

`sign_up`, fired only after the API returns 201.

## Primary conversion metric

**Signup rate** = sessions with `sign_up` ÷ sessions with `page_view`, counted on
`session_id`. For the experiment, it is split by `experiment_exposure.variant_id`
(`docs/experiments/trust-line-v1.md`).

## Analytics architecture / tooling

```
track(event, props) ── + event_id, session_id, variant ──► window.dataLayer   (always)
                                                     └──► gtag('event', …)    (after consent only)
```

- **dataLayer always.** Every event is pushed to `window.dataLayer` as `{ event, …props,
…context }`, before and after consent. Before consent nothing reads it. After Accept, gtag.js
  reads the same array. It acts only on the `gtag()` command entries, so each event reaches
  GA4 once, through `gtag('event', …)`. The plain `{ event, … }` objects are GTM-shaped. **If a
  GTM container is ever added, a custom-event trigger on them would double-count:** send
  through one path or the other.
- **GA4 only after consent.** The consent banner (`src/components/analytics/AnalyticsIsland.vue`)
  offers Accept and Reject, styled the same. `gtag.js` is requested only after Accept, now or on
  an earlier visit. Then Consent Mode v2 defaults are set to `denied` for all four signals, and
  `analytics_storage` alone is updated to `granted`. Ads signals stay denied.
- **No lost page view.** Events tracked before the choice are held in memory, at most 100. On
  Accept they are replayed to GA4. On Reject they are dropped.
- **The choice** is the `fxr_consent` cookie (`granted` | `denied`, 180 days). The inline
  `<head>` script exposes it as `<html data-consent>`, and CSS shows the banner only on `unset`.
- **GA4 config.** `send_page_view: false` (our `page_view` would otherwise double-count).
  `page_location` is origin + path + the cleaned `utm_*` only, and `page_referrer` is the
  referring origin only. gtag would otherwise send both URLs whole. `debug_mode: true` under
  `astro dev` only, so DebugView shows localhost traffic.
- **Measurement id:** `PUBLIC_GA4_ID`, inlined at build time. Unset or not `G-…` means
  dataLayer only, and gtag.js never loads. The Docker image receives it as a build arg
  (`compose.yaml`).

To report on `cta_id`, `code`, `reason`, `step`, `market`, `variant`, `variant_id`,
`fxr_session_id` or `event_id` in GA4, each must be registered as an event-scoped custom
dimension in the GA4 property. That is property configuration, outside this repo.

## Data-quality considerations

- **Consent bias.** GA4 sees only visitors who accept. Rates computed in GA4 describe that
  population. The dataLayer is complete, but nothing persists it.
- **Fired once.** `page_view` and `experiment_exposure` fire on the analytics island's mount.
  Astro mounts it once per page load. `signup_form_start` is guarded once per page view (reopening the dialog does not fire it again), and
  `sign_up` sits on the only 201 path. A lost 201 replayed through the Idempotency-Key still
  reaches that path only once.
- **Session id is per tab**, not a GA4 session: two tabs are two sessions, and there is no
  30-minute timeout.
- **No-JS visitors, and bots that do not run JavaScript**, produce no events (no island, no
  assignment). Bots that run JavaScript do produce events and are not filtered here.
- **Back/forward cache.** A page restored from the bfcache does not mount again, so it fires
  no second `page_view` or `experiment_exposure`. This is consistent with "per page load".
- **GA4 Enhanced Measurement** (property setting): turn off "Form interactions" and
  "Page changes based on browser history". Otherwise GA4 adds its own `form_start` and
  `page_view` events beside ours.
- **Ad blockers** block gtag.js. dataLayer events still fire, but GA4 never receives them.
