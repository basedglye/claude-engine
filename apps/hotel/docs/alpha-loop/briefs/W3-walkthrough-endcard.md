# W3 — The walkthrough engine and the end card

You are lane W3 of four concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained.

---

## 0. Orchestration rules (verbatim, non-negotiable)

1. **"Do this work yourself. Do not spawn subagents."** Two agents in H2b
   spent their entire budget re-delegating and returned having done
   nothing — roughly 140k tokens for zero output.
2. **"Do not run any `git` command. Do not commit, do not `git add`, do
   not stash."** The orchestrator commits.

7. **Every lane brief carries a verification command list and a
   non-vacuity obligation.** The obligation is specific: *break this exact
   thing, confirm the gate reds on this exact assertion, restore by clean
   rebuild, confirm green, report all four exit codes.*
8. **Every lane brief carries the rebuild discipline verbatim:** before
   any perturbation claim, `rm -f apps/hotel/tsconfig.game.tsbuildinfo &&
   rm -rf apps/hotel/dist-game` then rebuild — otherwise the "restore" is
   a no-op. This trap has bitten four times.
11. **Report format, fixed:** files touched; every command run with its
    exit code; the perturbation performed and the exact assertion that
    went red; **and what you did NOT do**. A lane that could not finish
    says so; a lane that skipped a verification step says so, unprompted.

Also: `npm run harness --silent -- <scenario>` (without `--silent`, npm's
banner pollutes the verdict JSON), and verdict JSON is written inside the
repo — Git Bash `/tmp` paths do not round-trip to the Node process here.

## 0.1 Dev-server rule

`npm run dev -w apps/hotel -- --port 5204 --strictPort`. **Port 5204 is
yours.** Never 5199 (`launch.json`'s port), never 5173 (routinely held by
another session; a live server there looks exactly like a stale bundle).
Kill it when done — `pkill` does not kill the Windows dev server; use
`Get-NetTCPConnection -LocalPort 5204 | Stop-Process`.

---

## 1. Goal

A first-time player must be able to complete the game's whole loop in one
sitting with no outside help. The vision
(`apps/hotel/docs/VISION-ALPHA.md` — binding, read it) specifies:

> Host-side, event-driven, no HUD chrome beyond one line of text and the
> reticle prompt: each step names the next physical act. Steps advance
> from sim events and state, never from timers. It can be skipped and
> never blocks input. Strings go through `t()`.

Plus an end card when the hotel reaches tier 2 ("The Grand Foyer opens")
showing the day count and cash, after which **play continues**.

Two hard constraints from this project's culture that this feature is
uniquely likely to violate:

- **This game has no HUD** (DESIGN §1, §4). One line of text at the bottom
  of the screen is the entire budget. No panels, no checklists, no
  progress bars, no arrows in the world.
- **The HUD must never intercept input.** `#hud` is
  `pointer-events: none` and is hidden entirely (`display: none`) while a
  terminal screen is focused, so the `reserva-readability` probe never
  sees it. Every element you add lives **inside** `#hud` and inherits
  that. An element added outside `#hud` is an automatic reject.

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/render/walkthrough.ts   (new file, yours)
apps/hotel/src/render/hud.ts
apps/hotel/src/render/i18n.ts
```

**Read-only for you:** everything else under `apps/hotel/src/render/**`
(`architecture.ts`, `decor.ts`, `lighting.ts`, `fixtures.ts`,
`exterior.ts` and `dev/**` belong to a live lane), and everything under
`apps/hotel/src/sim/**` (another live lane; import from it as `type` only).

**Contested — orchestrator-only:** `apps/hotel/src/main.ts`,
`apps/hotel/package.json`, `package.json`, `apps/hotel/index.html`,
`apps/hotel/vite.config.ts`, `.claude/launch.json`, anything under
`docs/` or `apps/hotel/docs/`, `CLAUDE.md`.

---

## 3. Wiring the orchestrator will do (do not write it yourself)

Build against exactly this, in `main.ts`:

```ts
const walkthrough = createWalkthrough();
let lastEventIndex = 0;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH" && !e.repeat) walkthrough.skip();
});

// per frame, beside the existing hudState build:
const events = sim.eventsSince(0).slice(lastEventIndex);
lastEventIndex += events.length;
walkthrough.advance({
  tick: sim.tick,
  events,
  hotel: readHotel(world),                 // { tier, cash, stars, day } | undefined
  nearDesk: playerNearDesk(world),         // boolean
  renovateCostMinor: readRenovateCostMinor(world),
});
const hudState: HudState = {
  /* ... existing fields, unchanged ... */
  walkthrough: walkthrough.current(),
  endCard: walkthrough.endCard(),
};
hud.update(hudState);
```

`KeyH` is the skip/toggle key. Add it to the `entry.controls` string.

---

## 4. Contracts you must provide

### 4.1 `walkthrough.ts`

Pure logic, **no DOM, no Three.js, no sim imports beyond types** — so it
can be unit-tested by feeding it synthetic event arrays.

```ts
export interface WalkthroughStep {
  /** Stable id, used by tests and by the HUD's data attribute. */
  id: string;
  /** i18n key; the HUD renders `t(textKey)`. */
  textKey: string;
}

export interface WalkthroughHotel {
  tier: number; cash: number; stars: number; day: number;
}

export interface WalkthroughInput {
  tick: number;
  events: readonly { type: string; payload: Record<string, unknown> }[];
  hotel: WalkthroughHotel | undefined;
  nearDesk: boolean;
  /** Cost of the next renovation in minor units, 0 at max tier. */
  renovateCostMinor: number;
}

export interface EndCard {
  titleKey: string;   // "endcard.title"
  bodyKey: string;    // "endcard.body", with {day} and {cash} placeholders
  day: number;
  cashMinor: number;
}

export interface Walkthrough {
  /** Feed the frame's new events and state. Idempotent for an empty
   *  event list plus unchanged state. Never throws. */
  advance(input: WalkthroughInput): void;
  /** The current step, or undefined when finished or skipped. */
  current(): WalkthroughStep | undefined;
  /** The end card, once tier 2 is reached, until dismissed. */
  endCard(): EndCard | undefined;
  dismissEndCard(): void;
  /** Turns the walkthrough off for the rest of the session. */
  skip(): void;
  skipped(): boolean;
}

export function createWalkthrough(): Walkthrough;
```

### 4.2 The step list (fixed — do not invent steps or reorder them)

| # | id | Advances when | textKey |
|---|---|---|---|
| 1 | `walk-to-desk` | `input.nearDesk === true` | `walkthrough.desk` |
| 2 | `take-papers` | event `guest.presenting` | `walkthrough.papers` |
| 3 | `use-terminal` | event `screen.appOpened` | `walkthrough.terminal` |
| 4 | `check-in` | event `guest.checkedIn` | `walkthrough.checkin` |
| 5 | `clean-room` | event `room.messCleaned` | `walkthrough.clean` |
| 6 | `repair-prop` | event `prop.repaired` | `walkthrough.repair` |
| 7 | `run-audit` | event `econ.audit` | `walkthrough.audit` |
| 8 | `hire-clerk` | event `staff.hired` | `walkthrough.hire` |
| 9 | `renovate` | event `hotel.renovated` | `walkthrough.renovate` |

Rules:

- Strictly ordered. When a step's condition is met, advance to the next
  one and **immediately re-evaluate** it against the same input, so a
  player who did things out of order is never stuck behind a step they
  already satisfied. (A player who has already hired a clerk should not be
  told to hire a clerk.)
- Step 9 (`renovate`) is only *shown* once `hotel.cash >=
  renovateCostMinor && renovateCostMinor > 0`; before that, show step 8's
  text or nothing. This is the vision's "You can afford to renovate" beat.
- After step 9 completes at `to === 2`, `current()` returns `undefined`
  and `endCard()` returns the card, built from the `hotel.renovated`
  payload's `day` plus the hotel's `cash`.
- **No timers anywhere.** No `setTimeout`, no tick-count thresholds, no
  "show for N frames". The only inputs are events and state.
- `skip()` is permanent for the session: `current()` returns `undefined`
  forever after, and `endCard()` also stays undefined.

### 4.3 `hud.ts`

Extend `HudState` with two optional fields and render them inside the
existing `#hud` element:

```ts
export interface HudState {
  // ... existing fields, unchanged ...
  walkthrough?: WalkthroughStep | undefined;
  endCard?: EndCard | undefined;
}
```

- One line of text, bottom-centre, above the interaction prompt, in the
  same visual language as the existing prompt (the file's CSS is the
  reference). It carries `data-visible="0|1"` the way the prompt does, and
  a `data-step` attribute with the step id so a gate can assert on it.
- The end card is a centred card **inside `#hud`**, `pointer-events:
  none`, that shows `t("endcard.title")` and `t("endcard.body")` with
  `{day}` and `{cash}` substituted (format money the way `ledger-app.ts`
  does: `$` + major + `.` + 2-digit cents). It disappears on the next
  `update()` where `endCard` is undefined — the orchestrator calls
  `dismissEndCard()` on any keypress.
- `#hud[data-phase="focused"] { display: none }` must keep applying to
  both new elements. Do not add a new stacking context or a new root.
- `update()` stays unconditional and idempotent per call — do **not**
  introduce a `last`-state diff. The existing comment in the file explains
  why (a caller mutating one `HudState` object in place would make any
  such diff silently no-op forever).

### 4.4 `i18n.ts`

Every player-visible string goes through `t()`, English only in source
(CLAUDE.md). Add the nine `walkthrough.*` keys, `endcard.title`,
`endcard.body`, and update `entry.controls` to mention `H` for hints.
Each step's text names **the next physical act**, in the imperative, and
never mentions a menu — e.g. "Walk to the front desk.", "Click the guest
to take their papers.", "Use the terminal.", "Open LEDGER and run the
night audit.", "You can afford to renovate — open LEDGER."

---

## 5. Verification commands and expected outcomes

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
```

Your change is host-side only, so **no sim hash may move**. Confirm with:

```
npm run harness --silent -- one-man-week --verify-replay
npm run harness --silent -- first-hire --verify-replay
```

Browser gates — the readability probe is the one your feature threatens:

```
npm run harness --silent -- reserva-readability --browser --verify-replay
npm run harness --silent -- fps-look-interact --browser --verify-replay
npm run harness --silent -- demo-visual --browser --verify-replay
```

Expected: exit 0, replay verified, and the command counts still exactly
**20** (`reserva-readability`), **12** (`fps-look-interact`), **18**
(`demo-visual`).

**Write a unit test.** Since `walkthrough.ts` is pure, add its tests to
the file you can reach without touching another lane's: create
`apps/hotel/src/render/walkthrough.test.ts`? **No** — this repo has no
per-file test runner. Instead, write a small standalone script at
`apps/hotel/dev/walkthrough-check.mjs` that imports the compiled module
and drives it through the full nine-step sequence plus three
out-of-order cases and the skip case, printing PASS/FAIL per case and
exiting non-zero on any failure. Report its output verbatim. (Ask the
orchestrator in your report to wire it into `apps/hotel/scripts/test.mjs`,
which is another lane's file this cycle.)

**Drive it by hand once.** The embedded Browser pane refuses pointer lock
(`WrongDocumentError`); drive the real app with
`window.__WORLDFORGE__.pointer.lock()` / `.look(dx)` and `page.keyboard`
from a Playwright script instead. Confirm: the line appears, it advances
on a real event, `H` clears it, and a terminal focus hides it entirely.

---

## 6. Non-vacuity obligation

1. Run `apps/hotel/dev/walkthrough-check.mjs` clean — expect exit 0.
2. **Perturb:** in `walkthrough.ts`, make `advance()` ignore the
   `guest.checkedIn` event (drop step 4's condition to `false`). Then
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-run. Expect the checker to fail on
   the exact case named `"step 4 advances on guest.checkedIn"`. Record the
   exit code and quote the failing line.
3. **Restore**, then `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-run. Expect green.
4. Report **all four** exit codes.

Second, smaller perturbation, because "never blocks input" is the property
most likely to regress silently: temporarily set the end card's CSS to
`pointer-events: auto`, rebuild clean, and confirm by hand that clicks on
the canvas stop reaching the game. Restore, rebuild clean, confirm they
reach it again. Report what you observed.

---

## 7. Report format (fixed)

1. **Files touched** — every path with a one-line summary.
2. **Every command run, with its exit code**, including the checker's
   full output.
3. **The perturbation** — what you broke, the exact failing case string,
   the four exit codes; plus the `pointer-events` observation.
4. **Hand-driven confirmation** — what you saw at each of the four
   checkpoints (line appears / advances / `H` clears / hidden when
   focused), and a screenshot path for the end card.
5. **What you did NOT do** — anything skipped, unfinished, or only
   partially verified. Say it unprompted.
6. **Wiring you need from the orchestrator** — at minimum, the `main.ts`
   hookup above and adding `walkthrough-check.mjs` to
   `apps/hotel/scripts/test.mjs`.
