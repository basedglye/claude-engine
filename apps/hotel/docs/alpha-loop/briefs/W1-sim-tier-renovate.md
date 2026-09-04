# W1 — Sim: `hotel.tier`, RENOVATE in LEDGER, tier-scaled economy, `alpha-loop`

You are lane W1 of four concurrent lanes on branch
`claude/grand-foyer-game-alpha-50b07d`, in the worktree
`C:\ClaudeGame\claude-engine\.claude\worktrees\grand-foyer-game-alpha-50b07d`.
Run everything from that directory. This brief is self-contained: you do
not need to read any planning conversation, and every value you need is
written down here. Where a number is given, it is a **decision already
made** — do not retune it. If you believe one is wrong, finish the work
with the given value and say so in your report.

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

Two more that apply to you specifically:

- **Verdict JSON is written inside the repo.** Git Bash `/tmp` paths do
  not round-trip to the Node process on this machine.
- **`npm run harness --silent -- <scenario>`** — without `--silent`,
  npm's banner pollutes the verdict JSON.

## 0.1 Dev-server rule

If you need a dev server: `npm run dev -w apps/hotel -- --port 5202
--strictPort`. **Port 5202 is yours.** Never 5199 (the project's
`launch.json` port) and never 5173 (routinely held by another session — a
live server on it looks exactly like a stale bundle). Kill it when you are
done: `pkill` does **not** kill the Windows dev server, use PowerShell
`Get-NetTCPConnection -LocalPort 5202 | Stop-Process`. You almost
certainly do not need a dev server for this lane.

---

## 1. Goal

Make the hotel's renovation tier a real sim fact, make RENOVATE a real
one-press action inside LEDGER, make demand and the rate ceiling scale
with that tier, and prove the whole arc with a new headless gate that
plays 14 in-game days with the owner bot and ends at tier 2, solvent.

Context you may want but must not edit: `apps/hotel/docs/VISION-ALPHA.md`
(the binding vision), `apps/hotel/docs/DESIGN.md`, `CLAUDE.md` at the repo
root (invariants), `apps/hotel/docs/HANDOFF.md` (enforced rules and traps).

---

## 2. Files you may touch (nothing else)

```
apps/hotel/src/sim/**            (components.ts, game.ts, economy.ts,
                                  ledger-app.ts, screen-data.ts, screen.ts,
                                  reviews.ts — sim files only)
apps/hotel/scripts/test.mjs      (the hotel unit suite)
scenarios/alpha-loop.scenario.mjs   (new file, yours)
scenarios/lib/hotel-owner.mjs    (the owner bot)
```

**Contested — orchestrator-only. Do not edit, do not "just add one
line":** `apps/hotel/src/main.ts`, `apps/hotel/package.json`,
`package.json`, `apps/hotel/index.html`, `apps/hotel/vite.config.ts`,
`.claude/launch.json`, anything under `docs/` or `apps/hotel/docs/`,
`CLAUDE.md`. Everything under `apps/hotel/src/render/**` belongs to other
live lanes — read it if you like, never write it.

**Wiring you need and will not do yourself:** none. Your work is reachable
entirely through existing seams (the shell's effect path and the exported
command factories). If you find you need a `main.ts` change, stop and say
so in your report.

---

## 3. Public contracts you must keep

- `buildScreenWorldView(world: IWorld): ScreenWorldView` — same signature,
  still one sweep over entities, still the single builder shared by
  `screenSystem` and `main.ts`.
- **`ScreenViewData` stays at exactly 9 top-level keys.** This is a hard
  budget (see the header comment in `screen-data.ts`). Everything you add
  goes *inside* an existing key. Adding a tenth key is an automatic
  reject.
- `isValidRate(rateMinor: number): boolean` keeps its current signature
  and behaviour (other call sites and unit tests depend on it).
- `capturePermille(rateMinor, willingnessMinor, reputationPermille,
  stars)` keeps working with four arguments — the new fifth parameter is
  **optional**, defaulting to 1000.
- Every existing exported command factory in `game.ts` keeps its
  signature.
- `HOTEL_APPS` still has exactly six entries. Renovation lives **inside
  LEDGER**; there is no seventh app.
- The `smoke` scenario's pinned state hash **3849639990** must not move —
  it is the engine demo, not the hotel.

## 3.1 Invariants (from `CLAUDE.md` and the H2a handoff)

- `apps/hotel/src/sim` is a purity root: no DOM, no Node built-ins, no
  `Math.random`, and **no transcendental `Math.*`** (`sin`/`cos`/`tan`/
  `atan2`/`exp`/`log`/`pow`/`hypot`/`cbrt`). Use `@claude-engine/space`'s
  `sim-math`. `node scripts/check-purity.mjs` enforces this.
- **No float ever lands in a component.** Money in minor units, ratios in
  permille with truncating division.
- **Write-through:** sim code mutates components ONLY via
  `setComponent()`. `stateHash()` is incremental and caches a
  per-(component, entity) digest that the write path invalidates, so
  `hotel.cash -= cost` on a fetched object is invisible to the hash and
  silently corrupts every replay. A `stateHash`/`stateHashSlow`
  disagreement is exit 3 and a P0.
- **No closure state.** `Sim.restore()` reruns `setup()` fresh; anything
  the sim needs across ticks lives in a component.
- Determinism: iterate collections in a deterministic order (sorted keys,
  never bare object-key order), and draw from the RNG **at generation
  time**, once, never at query time.

---

## 4. Contracts you must provide

### 4.1 The component field

```ts
// apps/hotel/src/sim/components.ts, on interface Hotel
/** Renovation tier: 0 Motel, 1 Hotel, 2 Grand Foyer. Starts at 0.
 *  Monotonic — nothing in the alpha lowers it. DISTINCT from
 *  `roomUnit.tier` and from the keys of `rateByTier`, which are ROOM
 *  tiers (1 and 2) and are unrelated. */
tier: number;
```

Initialised to `0` in `setupWithConfig`. Every new symbol you introduce
spells the distinction out — `hotelTier`, `RENOVATE_COST_MINOR`,
`TIER_DEMAND_MULT_PERMILLE`, `maxRateForHotelTier` — because `tier`
already means *room tier* everywhere in this codebase and confusing the
two is the single most likely way this lane produces a subtle bug.

### 4.2 Constants (in `economy.ts`, exported)

```ts
export const MAX_HOTEL_TIER = 2;

/** Indexed by TARGET hotel tier; index 0 unused. $750.00 then $2,500.00. */
export const RENOVATE_COST_MINOR: readonly number[] = [0, 75_000, 250_000];

/** Stars required to renovate INTO that tier. MAX_STARS is 2 this phase
 *  (reviews.ts), so 2 is the ceiling and cash is the real gate. */
export const RENOVATE_STAR_REQ: readonly number[] = [0, 2, 2];

/** Lowest hotel tier at which a segment books at all. */
export const SEGMENT_MIN_HOTEL_TIER: Readonly<Record<string, number>> = {
  family: 0, leisure: 1, business: 2,
};

/** Multiplies the capture rate, indexed by hotel tier. */
export const TIER_DEMAND_MULT_PERMILLE: readonly number[] = [700, 1000, 1400];

/** PRICER's ceiling, indexed by hotel tier. */
export const MAX_RATE_BY_TIER_MINOR: readonly number[] = [6_000, 12_000, 25_000];

export function maxRateForHotelTier(hotelTier: number): number;
export function isValidRateForHotelTier(rateMinor: number, hotelTier: number): boolean;
```

`isValidRateForHotelTier` is `isValidRate`'s rules with
`maxRateForHotelTier(hotelTier)` as the upper bound; clamp `hotelTier`
into `[0, MAX_HOTEL_TIER]` defensively rather than indexing out of range.

### 4.3 Demand

- `capturePermille(rateMinor, willingnessMinor, reputationPermille,
  stars, tierMultPermille = 1000)` — multiply the final capture by
  `tierMultPermille` with truncating integer division by 1000, applied
  **before** the existing `[0, 1000]` clamp.
- `arrivalsForDay(rng, rateByTier, repBySegment, stars,
  defaultReputationPermille, hotelTier)` — new **sixth** parameter. For
  each segment in sorted order: if `SEGMENT_MIN_HOTEL_TIER[segment] >
  hotelTier`, the segment contributes `0` and **takes no RNG draws at
  all**; otherwise it draws exactly as it does today, with
  `TIER_DEMAND_MULT_PERMILLE[hotelTier]` passed through. Both call sites
  in `game.ts` (the day rollover and the day-1 draw in `setupWithConfig`)
  pass the live/initial hotel tier.

This changes the RNG stream. That is expected and allowed — every
headless gate is re-pinned this cycle. What is *not* allowed is a
divergence between the live run and the replay leg.

### 4.4 The renovate path

```ts
// game.ts, exported alongside the other command factories
export function renovateCommand(tick: number, actor = PLAYER_ACTOR): Command;
// -> { tick, actor, type: "hotel.renovate", payload: {} }
```

`applyRenovate(s: Sim, actor: string, _payload: Record<string, never>):
void` is the **single validated path**, reached from exactly two places,
the same way `applyPricerRate` is: the command loop in `staffSystem` (add
an `else if (c.type === "hotel.renovate")` branch) and the effect switch
in `screenSystem` (add an `else if (effect.type === "hotel.renovate")`
branch). No third caller.

Validation, in this exact order, each failure emitting and returning:

| # | Check | On failure |
|---|---|---|
| 1 | actor's entity exists, has a `pos`, and is within `DESK_RADIUS_MM` of `floor.desk` | `screen.denied { reason: "out-of-range" }` |
| 2 | `hotel.tier < MAX_HOTEL_TIER` | `screen.denied { reason: "max-tier" }` |
| 3 | `hotel.stars >= RENOVATE_STAR_REQ[next]` | `screen.denied { reason: "stars-too-low" }` |
| 4 | `hotel.cash >= RENOVATE_COST_MINOR[next]` | `screen.denied { reason: "insufficient-cash" }` |

On success, in one `setComponent` on `hotel`: `tier: next`,
`cash: hotel.cash - cost`. Then spawn one ledger entry — follow the exact
pattern `applyDeskDecision` uses for the room charge:

```
{ day: hotel.day, debitAccount: "expense:capex", creditAccount: "cash",
  amountMinor: cost, memo: `renovation to tier ${next}` }
```

Then `s.emit("hotel.renovated", { from, to: next, costMinor: cost,
day: hotel.day, actor })`.

`expense:capex` is deliberately `expense:`-prefixed so the day-close
sweep and `one-man-week`'s "every entry nets to zero" assertion keep
working untouched.

### 4.5 The view (no tenth top-level key)

Extend the **existing** `ScreenLedgerView` (which rides under the
existing `ledger` key that LEDGER and AUDIT already read):

```ts
export interface ScreenLedgerView {
  // ... existing seven fields, unchanged ...
  /** Hotel renovation tier, 0..2. */
  hotelTier: number;
  /** Cost of the NEXT renovation, or 0 at max tier. */
  renovateCostMinor: number;
  /** Stars required for the next renovation, or 0 at max tier. */
  renovateStarReq: number;
  /** True when pressing RENOVATE at the desk would actually succeed
   *  (tier, stars and cash all satisfied). Proximity is NOT folded in —
   *  the view has no actor. */
  renovateAvailable: boolean;
}
```

Also make PRICER's ceiling tier-aware **inside the existing `pricing`
key**: `pricing.maxRateMinor` becomes `maxRateForHotelTier(hotel.tier)`.
`applyPricerRate` validates with `isValidRateForHotelTier`, and its
existing `"rate-out-of-bounds"` denial reason is unchanged.

### 4.6 LEDGER's RENOVATE button

In `ledger-app.ts`, add one button to the layout rect table and to
`paintSpec`, plus a status line. It sits below the STAFF BUDGET line and
above the CLOSED DAYS rule; place it at `{ x: 8, y: 380, w: 200, h: 18 }`
and move nothing that already exists except by the minimum needed to keep
the panel legible. `layout()` and `reduce()`'s hit test must keep using
the one shared `layoutRects()` geometry source — that single-source rule
is what keeps the readability probe and the click path in agreement.

- The status line always prints, locked or not, with the exact cost and
  the exact gap — same anti-dark-pattern stance as the STAFF BUDGET line
  (DESIGN §6). At max tier it reads that the Grand Foyer is open.
- `reduce` returns `{ state, effect: { type: "hotel.renovate", payload: {} } }`
  when the RENOVATE rect is hit **and** `renovateAvailable` is true; when
  it is false it returns the state unchanged (the app's guard is a
  courtesy — the sim re-checks everything regardless).
- All strings in this app are already English-in-source screen text (it is
  a rendered 1990s terminal, not HUD chrome); follow the file's existing
  convention exactly, do not introduce `t()` here.

### 4.7 The `alpha-loop` scenario

New file `scenarios/alpha-loop.scenario.mjs`, modelled closely on
`scenarios/one-man-week.scenario.mjs` (read it first — it is the template
for how a headless gate is written in this repo).

```
name:  "alpha-loop"
seed:  "hotel-alpha-loop-1"
ticks: 84_000            // 14 days at 6,000 ticks/day
setup: setupWithConfig(sim, { ...DEFAULTS, arrivals: "demand",
                              upkeep: true, startingCashMinor: 0 })
bots:  [ makeOwnerBot({ floor, grid, playerEntity: PLAYER_ENTITY,
                        schedule: [{ day: 2, action: "set-rate-down" }],
                        renovate: true }) ]
```

Add a `renovate` behaviour to `scenarios/lib/hotel-owner.mjs` (off by
default, so no existing scenario changes behaviour): when the owner is at
the desk with the terminal focused, LEDGER open, and the view's
`renovateAvailable` is true, click the RENOVATE rect. Derive the click
coordinates from `hotelShell.layout()` exactly as the bot's other screen
clicks do — **no teleports, no component writes, no privileged
commands**; every action must be a command a human could produce. Also
raise the owner's rate toward the new ceiling after each renovation
(reuse the existing `set-rate` machinery), or the tier-2 economy never
pays for itself.

Assertions (all of them; each must be able to fail):

1. exactly 14 `econ.audit` events;
2. exactly two `hotel.renovated` events, with `to: 1` then `to: 2`, in
   that order;
3. the `hotel` component ends with `tier === 2`;
4. the hotel is solvent at the end (`cash > 0`);
5. no `guest.arrived` event carrying `segment: "business"` occurs before
   the `hotel.renovated { to: 2 }` event, and at least one occurs after —
   use the index order of `sim.eventsSince(0)`, which is the emission
   order. (To make this checkable, add `segment` to the `guest.arrived`
   payload — a payload extension, not a shape change;
   `s.emit("guest.arrived", { guestEntity, segment })`.)
6. at least one `hotel.renovated` was preceded by a `screen.denied
   { reason: "insufficient-cash" }` **or** the run recorded at least one
   day where `renovateAvailable` was false — i.e. the money gate was
   actually felt, not walked past on day 1;
7. zero `nav.stuck` events across the whole run;
8. `roomUnit.messCount` agrees with a live `mess` scan for every room
   (carry this one over from `one-man-week` verbatim — it is the
   cheapest structural canary in the suite);
9. the ledger balances: every entry is a debit/credit pair netting to
   zero, and at least one `expense:capex` entry exists.

Write the derived facts (arrivals, check-ins, the tick each renovation
landed on, closing cash) into the file's header comment the way
`one-man-week` does, from a real run — they are the next reader's map.

### 4.8 Unit tests

Extend `apps/hotel/scripts/test.mjs` with direct checks for:
`isValidRateForHotelTier` at each tier's boundary and one step past it;
`arrivalsForDay` returning zero for `business` at tiers 0 and 1 and
non-zero-capable at tier 2; `capturePermille`'s four-argument form
returning exactly what it returns today (the back-compat guarantee); and
`applyRenovate`'s four refusal reasons, one test each, driven through
`renovateCommand`.

---

## 5. Verification commands and expected outcomes

Run all of these, from the worktree root, and report every exit code.

```
rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf apps/hotel/dist-game
npm run build                                  # exit 0
npx tsc -p apps/hotel/tsconfig.json --noEmit   # exit 0
npx eslint .                                   # exit 0
node scripts/check-purity.mjs                  # exit 0, 8 roots
npm test                                       # exit 0, smoke hash 3849639990 UNCHANGED
npm run test --workspaces --if-present         # exit 0
```

Then every headless gate, each with `--verify-replay`:

```
npm run harness --silent -- smoke --verify-replay
npm run harness --silent -- demo-walk --verify-replay
npm run harness --silent -- bots-headless --verify-replay
npm run harness --silent -- walk-collide --verify-replay
npm run harness --silent -- corridor-headon --verify-replay
npm run harness --silent -- checkin-rush --verify-replay
npm run harness --silent -- fraud-catch --verify-replay
npm run harness --silent -- fraud-catch-b --verify-replay
npm run harness --silent -- zen-clean --verify-replay
npm run harness --silent -- first-hire --verify-replay
npm run harness --silent -- escalation-stars --verify-replay
npm run harness --silent -- one-man-week --verify-replay
npm run harness --silent -- alpha-loop --verify-replay
```

Expected: every one `passed: true`, `--verify-replay` verified, exit 0.
**Exit 3 is a P0** — it means replay divergence or a write-through
violation, and it is never answered by loosening an assertion. Report the
new state hash of every scenario whose hash moved; the stream change in
§4.3 means most of them will, and that is expected — a *divergence* is
not.

Some of these gates' own assertions may now fail on content (e.g. a
different number of guests arrives at tier 0 than at the old flat demand).
Where an assertion fails because the world legitimately changed, adjust
the assertion to the new truth **and say exactly which assertion you
changed and why in your report**. Where an assertion fails because
something broke, fix the code.

Report the harness verdict JSON path for `alpha-loop` (written inside the
repo, never `/tmp`).

---

## 6. Non-vacuity obligation

Your new gate must be shown red before it counts.

1. Run `alpha-loop --verify-replay` clean. Record exit code (expect 0).
2. **Perturb:** in `applyRenovate`, change the cash check from
   `hotel.cash >= cost` to `hotel.cash >= cost * 10`. Then
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, and re-run. Expect red on the exact
   assertion `"the hotel ends at tier 2"` (and on the two-renovation
   assertion). Record the exit code and quote the failing assertion
   string verbatim from the verdict JSON.
3. **Restore** the line, then
   `rm -f apps/hotel/tsconfig.game.tsbuildinfo && rm -rf
   apps/hotel/dist-game`, rebuild, re-run. Expect green.
4. Report **all four** exit codes.

Do the same, more briefly, for the segment-gating assertion: temporarily
set `SEGMENT_MIN_HOTEL_TIER.business = 0`, clean-rebuild, and confirm
assertion 5 goes red. Restore and confirm green.

---

## 7. Report format (fixed)

Report, in this order:

1. **Files touched** — every path, with a one-line summary of the change.
2. **Every command run, with its exit code** — including the failed and
   perturbed runs.
3. **The perturbation** — what you broke, the exact assertion string that
   went red, and the four exit codes.
4. **Numbers** — the new state hash of every headless gate whose hash
   moved; `alpha-loop`'s closing cash, the tick of each renovation, and
   the day count at tier 2.
5. **Assertions you changed in existing scenarios**, each with why.
6. **What you did NOT do** — anything you skipped, could not finish, or
   verified only partially. Say it unprompted.
7. **Wiring you need from the orchestrator**, if any.
