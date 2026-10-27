# Daily summary e-mail: how it is built, previewed and tested

The summary goes out every day at 08:30 Singapore time from the GitHub Actions workflow **Daily summary email**
(`.github/workflows/digest.yml`, `workers/src/digest.ts`). The same numbers also go to Telegram (plain text, compact) and to
the WhatsApp share (**Share** in the app).

## Where each number comes from

| In the e-mail | Built by | Same figure as |
|---|---|---|
| Net worth, the four tiles, today, overall profit and per cent | `digestWealth` (`packages/core/src/digest-wealth.ts`): `bankOverview` + `classCards` | Home's headline and its four cards |
| Goals: saved, needed, pace, shortfall, months late, monthly top-up | `summariseGoals` (`goal-summary.ts`, also used by the Goals page and Home) + `goalCard` (`digest-goals.ts`) | Goals page and Home |
| Retirement card | `buildPlan`, `assess`, `monteCarlo` (`retirement.ts`, `planning.ts`) + `retirementCard` | "Can I retire now?" |
| Needs you | `attentionItems` (`home.ts`), then tax and rate lines | Home's "Needs you" |
| What changed | `netWorthChanges`, `moversBetween` over the saved snapshots, `biggestMaturities` | Home's "What changed" |
| Late inputs, values as of | `freshnessSummary`, newest recorded value | Home's header |
| Subject | `digestSubject` (`digest-subject.ts`) | |

Rows are read in `packages/data/src/digest-input.ts` and put together by `assembleDigest` (`digest-assemble.ts`); the page is drawn
by `buildDigestEmail` (`digest-email.ts`). `apps/web/lib/demo-digest.test.ts` builds the sample household both ways and fails if
the e-mail and Home ever disagree on a shared figure.

## Settings that change it

- Settings > Notifications: send the summary, extra recipients, **Include the goals view**, **Include the retirement view**. A
  household whose row predates a switch behaves as on (database default `true`; the code also treats a missing value as on).
- `digest` numbers (defaults in `packages/core/src/config.ts`, overridable in the household's stored configuration, not yet
  on a Settings screen): `aheadMargin` (a goal is "ahead" rather than "on
  track" when the pace beats its cost by more than this share, default 10%), `needsYouMax` (5), `changesMax` (3) and
  `monteCarloRuns` (2,000; 0 leaves the chance of success out).
- The reminder windows, "maturing soon" days and the stale-rate days are the existing Settings.

## Preview (no sending)

- Signed in: **Settings > Notifications > Preview today's e-mail** (`/settings/notifications/preview`). It builds today's message
  from live figures through the same code as the 08:30 job and shows it at 390 px and 680 px in sandboxed frames (`sandbox=""`,
  no script can run), then the plain text.
- Public sample with invented data: `/demo/digest` (used by the Playwright spec `apps/web/e2e/digest.spec.ts`).

## A test send into your inbox ("digest test")

The Gmail sign-in (`SMTP_USER`, `SMTP_APP_PASSWORD`) exists only as GitHub Actions secrets, so the web app cannot send mail and has
no "send me a test" button. Instead:

1. GitHub > Actions > **Daily summary email** > **Run workflow**.
2. Tick **Digest test** and run it.

It sends one e-mail with `[Test]` in front of the subject to the people who can sign in to each household that switched the
summary on (never to the extra recipients), writes nothing to the delivery log and sends nothing to Telegram, so it neither uses up
nor blocks the real summary of the day. Leaving **Digest test** unticked runs the real job. No new secret is needed.

## Mail filters

Match the subject on `Family Wealth Summary` (the text before the first ` · `). Everything after it (the date, the net worth, the
day's change and "N need you") changes from day to day and is not stable. A test send adds `[Test] ` at the very front.

## What has not been checked here

The HTML is checked in a browser (Playwright, light and dark, phone and wide) and by tests, not in Gmail itself. After the first
real send, open it in the Gmail app on a phone, in light and dark mode, and check the tiles wrap two to a row.
