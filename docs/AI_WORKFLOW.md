# AI-native workflow

Claude Code built most of this project. The setup around it is committed:
[`CLAUDE.md`](../CLAUDE.md), [`.claude/`](../.claude/) and [`.mcp.json`](../.mcp.json).
[`AI_LOG.md`](../AI_LOG.md) records every session. "(AI_LOG 5)" means entry 5.

## How it works

```
plan → build → automatic checks → review / audit → browser QA → log
```

1. **Plan.** Each task starts as a short brief: goal, constraints, when it's done, how to check
   it. Most briefs came from a separate planning session with no access to the code.
2. **Build.** Claude, or the `implementer` agent, writes the code. Every file is formatted and
   linted as it is saved, and the types are checked before Claude finishes.
3. **Review.** `reviewer` checks the change. `analytics-auditor` checks the tracking, and it
   repeats until it reports clean.
4. **QA.** `qa-a11y-perf` runs the signup flow in a real browser.
5. **Log.** An AI_LOG entry records what was delegated, what was corrected and what was checked.

Outside this loop, a read-only server agent inspected the host for
[`ARCHITECTURE.md`](ARCHITECTURE.md), and a separate session added the security headers
(AI_LOG 9).

## Project instructions

[`CLAUDE.md`](../CLAUDE.md) gives every session the goal, the stack and the rules. The rules
that matter most:

- Design tokens only, never raw colours.
- Every analytics event is defined in one file, and no personal data goes into analytics.
- No JavaScript outside the interactive components, with one small exception that is
  documented in DECISIONS.
- A performance budget (LCP < 2.5 s, CLS < 0.1) and WCAG 2.2 AA accessibility.
- Docs only claim what the repo shows. Claude never commits, pushes or touches the server.

It also defines when a change counts as done: checks pass, tests are written, it's reviewed,
and it's logged.

## Agents

Four agents in [`.claude/agents/`](../.claude/agents/), each with one job and only the tools
that job needs.

| Agent               | What it does                                                              | What it can't do                                        |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| `implementer`       | Writes the code and tests for one task                                    | Open a browser, add events outside `/add-event`, commit |
| `reviewer`          | Checks a change for bugs, rule breaks and scope creep                     | Edit or run anything                                    |
| `analytics-auditor` | Checks every event fires once, in the right place, with no personal data  | Edit anything                                           |
| `qa-a11y-perf`      | Runs the signup flow in a browser; checks accessibility, layout and speed | Edit code; visit the real fxreplay.com                  |

## Commands and hooks

- **`/add-event`** adds a tracking event in one step. It refuses any property that could hold
  personal data.
- **`/new-experiment`** sets up an A/B test: the variant flag, the exposure event and a doc
  outline. It never invents numbers.
- **Hooks:** each edited file is formatted and linted straight away, and the full type check
  runs when Claude finishes a turn.
- **Blocked actions:** Claude cannot read `.env` files, commit, push, or connect to a server.

## MCP

**Used:**

- **Playwright** lets the QA agent drive a real browser. It is limited to localhost and the
  challenge URL.
- **context7** gives current Astro, Vue and zod docs, because this stack is newer than most
  training data.

**Proposed for production** (not built; read-only where possible):

| Server             | Why                                        | Used by                                              |
| ------------------ | ------------------------------------------ | ---------------------------------------------------- |
| **Figma**          | Build sections from the real designs       | `implementer`                                        |
| **Convert**        | Keep A/B tests defined in one place        | `/new-experiment` (drafts them; a human starts them) |
| **GA4 / BigQuery** | Check real event data; analyse experiments | `analytics-auditor`                                  |
| **Notion**         | Hypotheses and experiment backlog          | `/new-experiment`                                    |

## Where AI helped

- **Caught outdated assumptions.** The current Astro is 7, not 6, and the newest TypeScript
  breaks the linter (AI_LOG 1).
- **Found build failures early.** The database library failed to install in the slim Docker
  image, and a clean install failed too (AI_LOG 2).
- **Added security I hadn't asked for.** The user list now requires a token. Otherwise every
  signup email would have been public (AI_LOG 3).
- **Checked a lot, fast.** Every API status code, the experiment script, and text contrast at
  five screen widths (AI_LOG 3, 5, 7, 8).

## Where I corrected AI

**Caught by my agents:**

- `reviewer` found the API accepted 1 GB requests; they're now capped at 16 KB (AI_LOG 3).
- `reviewer` found the hero overlay had no effect; `qa-a11y-perf` measured the failing contrast
  (AI_LOG 8).
- `analytics-auditor` took three passes to reach clean. It found full referrer URLs and
  possible personal data in UTM values going to GA4 (AI_LOG 7).
- `qa-a11y-perf` found keyboard focus lost while saving (AI_LOG 5).

**Corrected by me:**

- **Docker setup (AI_LOG 2).** In my own run the default setup failed, so it was split into a
  local file and a production overlay.
- **Hero image (AI_LOG 8).** It passed review and QA, but I saw it was cropped. It now shows
  whole at every width.
- **Code structure (AI_LOG 6).** The signup form had grown into one 461-line component. I set
  the target layout: shared types in `src/types/`, an API client, a composable for the logic,
  and three small components.
- **Command rules (AI_LOG 7).** Event naming and experiment exposure follow the brief, not the
  commands' defaults.

## What I did myself

The pattern was the same throughout: I set the approach, Claude implemented it, and the agents
checked it.

| Area           | What I decided                                                                               | Then delegated to AI                    |
| -------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| Product        | Email-only signup with the market asked afterwards; signup in a modal; the 5 markets         | The API, the signup flow and its states |
| API contract   | 422 vs 400, the rate limit (5 per minute), keeping the admin token                           | Handlers, database and tests            |
| Code structure | Shared types in `src/types/`, an API client, a composable and small components               | The refactor and its tests              |
| Analytics      | The event taxonomy, with event types defined per user scenario                               | The typed `track()` and the call sites  |
| Analytics      | Consent first (events buffered until Accept); a session id that doesn't clash with GA4's own | The consent banner and GA4 loading      |
| Experiment     | The A/B script is one tested function, run before first paint                                | The wiring and tests                    |
| Landing page   | The copy, the hero image, and the overlay sized for contrast                                 | The components and styling              |
| Hosting        | Traffic through the server's shared Caddy, with no port exposed                              | Docker and Compose files                |

AI_LOG holds the evidence for each row (entries 2–8).

- **Delegated entirely:** scaffolding and tooling, and every review, audit and QA run.
- **Validated:** type check, lint, 213 tests and a build on every code change; API smoke tests;
  Lighthouse runs; and reading the QA screenshots myself. The feature entries in AI_LOG list
  what was **not** verified.

## What I'd do next

- **CI** that runs the same checks on every push.
- **Connect GA4/BigQuery**, so the auditor checks live data and experiment analysis is
  repeatable.
- **Close the open items** in AI_LOG, starting with a clearer message when an email is already
  registered.
