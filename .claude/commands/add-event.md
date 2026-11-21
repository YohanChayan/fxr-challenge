---
description: Add an analytics event to the taxonomy and the typed track() in one step
argument-hint: <event_name> "<trigger>" [prop:type ...]
---

Add one analytics event. Arguments: `$ARGUMENTS`

Format: `<event_name> "<trigger, in plain words>" [prop:type ...]`, where type is `string`,
`number`, `boolean`, or a literal union like `'hero'|'nav'`.
Example: `/add-event cta_click "user clicks a Try free CTA" location:'hero'|'nav'|'footer'`

## Steps

1. **Validate the input before writing anything.**
   - Name is `snake_case`. Use GA4's recommended event name when one exists (`page_view`,
     `sign_up`); otherwise follow the catalogue's `object_action` style (`signup_submit`,
     `cta_click`), never camelCase.
   - Reject if an event with this name already exists in `src/analytics/taxonomy.ts`; show it.
   - **Refuse PII.** Reject any property that could hold an email, name, phone, IP address,
     free text or raw user input (e.g. `email`, `user_email`, `name`, `message`, `query`).
     Say which property was refused and suggest a non-PII alternative (`email_domain_type`,
     `has_referrer`, an opaque `user_id`).
   - If the trigger or any property is ambiguous, ask once, then stop.

2. **Edit `src/analytics/taxonomy.ts`** — add the entry to the `taxonomy` object. If the file
   does not exist yet, create it in this shape:

   ```ts
   // Single source of truth for analytics events. track() is typed from this object.
   export const taxonomy = {
     cta_click: {
       trigger: 'User clicks a "Try FX Replay Free" CTA',
       props: {} as { location: 'hero' | 'nav' | 'footer' },
     },
   } as const;

   export type EventName = keyof typeof taxonomy;
   export type EventProps<E extends EventName> = (typeof taxonomy)[E]['props'];
   ```

3. **Make sure `track()` is typed from the taxonomy** in `src/analytics/track.ts`. If the file
   does not exist, create it with this signature, so that a new event needs no change here:

   ```ts
   import type { EventName, EventProps } from './taxonomy';
   export function track<E extends EventName>(event: E, props: EventProps<E>): void;
   ```

   The body sends to whichever sink `docs/ANALYTICS.md` names, and must attach session context
   (anonymous id, session id, page, experiment variants) centrally — never at call sites.

4. **Update `docs/ANALYTICS.md`** — add one row to the events table: name, trigger, properties,
   and the funnel step it belongs to (or "—").

5. **Do not add call sites.** Report where the event _should_ fire (file and handler), so the
   implementer wires it and `analytics-auditor` can verify it.

6. Run `npm run typecheck` and report the result.

## Output

The taxonomy entry as added, the ANALYTICS.md row, the suggested call site, and the typecheck
result.
