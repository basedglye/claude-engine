# GRAND FOYER alpha loop — cycle 1 work breakdown (COO)

Written 2026-09-02 by the integrating COO for branch
`claude/grand-foyer-game-alpha-50b07d`. Binding inputs, in precedence
order: [VISION-ALPHA.md](../VISION-ALPHA.md) (CEO, binding) →
`CLAUDE.md` at the repo root (invariants) → [DESIGN.md](../DESIGN.md) →
[ALPHA-LOOK.md](../ALPHA-LOOK.md) (verified host-side state) →
`docs/PLAN-ALPHA.md` §6 (orchestration constitution).

This file is the plan. The four brief files under `briefs/` are what the
workers actually receive; each is self-contained and assumes no knowledge
of this document or of the conversation that produced it.

---

## 0. Shape of the cycle

**Cycle 1 (this document): four concurrent Sonnet lanes, file-disjoint.**

| Lane | Name | Owns |
|---|---|---|
| W1 | Sim — tier, RENOVATE, tiered economy, `alpha-loop` gate | `apps/hotel/src/sim/**`, `scenarios/alpha-loop.scenario.mjs`, `scenarios/lib/hotel-owner.mjs`, `apps/hotel/scripts/test.mjs` |
| W2 | Motel-tier look — procedural textures + tier plumbing | `apps/hotel/src/render/{architecture,decor,lighting,fixtures,exterior,procedural.ts}`, `apps/hotel/dev/**` |
| W3 | Walkthrough engine + end card | `apps/hotel/src/render/{walkthrough.ts,hud.ts,i18n.ts}` |
| W4 | Single-file artifact build + pointer-lock fallback + Netlify | `apps/hotel/scripts/build-artifact.mjs`, `apps/hotel/src/render/pointer-fallback.ts`, `apps/hotel/netlify.toml` |

**Cycle 2 (reserved, not briefed here):** playtest QA against the built
artifact, tuning passes on whatever cycle-1 numbers the `alpha-loop` gate
proves wrong, and `apps/hotel/docs/WALKTHROUGH.md` written by driving the
real build (screenshots included). Cycle 2 does not start until every
cycle-1 lane has passed the COO checklist in §5 and the integration in §4
is committed and green.

Disjointness is real, and was checked against the tree rather than assumed
(PLAN-ALPHA §6.4): W1 touches no `render/` file, W2 touches no `hud.ts`,
`i18n.ts` or `scripts/`, W3 touches only three render files none of which
W2 owns, W4 adds three new files and edits none. `assets.ts`, `quality.ts`,
`floorplan.ts`, `characters.ts`, `upkeep.ts`, `screens.ts`, `documents.ts`
and `door-leaf.ts` are **read-only for everybody this cycle** — if a lane
believes it must edit one, it stops and reports (rule 5).

**Orchestrator-only (contested) files.** No lane may touch these; each
brief says what wiring it needs instead, and the COO does that wiring in
§4:

```
apps/hotel/src/main.ts        apps/hotel/index.html
apps/hotel/package.json       package.json / package-lock.json
apps/hotel/vite.config.ts     apps/hotel/assets.manifest.json
CLAUDE.md                     docs/** and apps/hotel/docs/**
.claude/launch.json           docs/reviews/**
```

---

## 1. Decisions the COO makes now, so no worker invents a value

The vision leaves the sim contract open. It is closed here. Every number
below is a committed constant with a name; a worker that finds one of them
wrong reports it and does not silently retune.

### 1.1 The tier lives on the hotel singleton

```ts
/** components.ts, on `Hotel`. */
/** Renovation tier: 0 Motel, 1 Hotel, 2 Grand Foyer. Starts at 0.
 *  Monotonic — nothing in the alpha lowers it. Distinct from
 *  `roomUnit.tier` and from the keys of `rateByTier`, which are ROOM
 *  tiers (1 and 2) and are unrelated. */
tier: number;
```

**Naming hazard, called out because it will bite:** `tier` already means
*room* tier in this codebase (`roomUnit.tier`, `rateByTier`,
`ROOM_RATE_MINOR`, `pricer.setRate`'s payload). The new field is the
*hotel* tier. In every new symbol, spell it out: `hotelTier`,
`HotelTier`, `RENOVATE_COST_MINOR`, `TIER_DEMAND_MULT_PERMILLE`. Only the
component field itself is bare `tier`, because it is namespaced by
`hotel.`.

### 1.2 The renovate command, its payload, its event

| Thing | Value |
|---|---|
| Command type | `"hotel.renovate"` |
| Payload | `{}` — no arguments. The next tier is always `hotel.tier + 1`; letting the caller name a target tier is a second source of truth and an obvious cheat surface. |
| Command factory | `renovateCommand(tick: number, actor = PLAYER_ACTOR): Command` in `game.ts`, exported, alongside `pricerSetRateCommand` etc. |
| Screen effect | `{ type: "hotel.renovate", payload: {} }`, returned by `ledgerApp.reduce` as `{ state, effect }` |
| Apply function | `applyRenovate(s, actor, _payload)` — the single validated path, called from `staffSystem`'s command loop **and** from `screenSystem`'s effect switch, exactly as `applyPricerRate` is |
| Success event | `hotel.renovated` with payload `{ from, to, costMinor, day, actor }` |
| Refusal events | `screen.denied` with `reason` ∈ `"out-of-range"`, `"max-tier"`, `"stars-too-low"`, `"insufficient-cash"` |

Validation order is fixed (so a scenario can assert on one reason at a
time): range → max-tier → stars → cash.

### 1.3 Costs and star requirements

```ts
// economy.ts
/** Indexed by TARGET hotel tier. Index 0 is unused (you never renovate
 *  to 0). $750.00 then $2,500.00. */
export const RENOVATE_COST_MINOR: readonly number[] = [0, 75_000, 250_000];
/** Stars required to renovate INTO that tier. MAX_STARS is 2 this phase
 *  (reviews.ts), so 2 is the ceiling; cash is the real gate and stars are
 *  the "you are not running a dump" gate. Raising MAX_STARS is explicitly
 *  out of scope for cycle 1. */
export const RENOVATE_STAR_REQ: readonly number[] = [0, 2, 2];
export const MAX_HOTEL_TIER = 2;
```

Rationale for the two costs: `HIRE_THRESHOLD_MINOR` is $600 and the
one-man week closes at roughly $3,164 of cumulative profit over 7 days at
tier 0 economics. $750 is reachable in the same order of days as the hire
(so days 3–5 in a 14-day run), and $2,500 is only reachable once tier 1's
demand multiplier and rate ceiling are working — which is exactly the
progression the vision asks for. If the `alpha-loop` gate cannot reach
tier 2 inside 14 days, **the numbers move, not the gate's day count**, and
they move here in one commit by the COO after the lane reports.

### 1.4 Cash and the ledger

`applyRenovate` follows the existing single path for money (the pattern in
`applyDeskDecision` around `cash: hotel.cash + rate`): one `setComponent`
on `hotel` adjusting `cash`, plus one spawned `ledgerEntry`:

```
{ day: hotel.day, debitAccount: "expense:capex", creditAccount: "cash",
  amountMinor: RENOVATE_COST_MINOR[to], memo: `renovation to tier ${to}` }
```

`expense:capex` is a new account string and is deliberately an
`expense:` prefix so the existing day-close revenue/expense sweep and the
`one-man-week` "every entry nets to zero" assertion keep working
unchanged.

### 1.5 Demand and rate scaling by tier

```ts
// economy.ts
/** The lowest hotel tier at which a segment will book at all. The vision's
 *  "tier 0 fills only with the cheap segment; tier 2 unlocks the premium
 *  one", made concrete against the three segments that exist. */
export const SEGMENT_MIN_HOTEL_TIER: Readonly<Record<string, number>> = {
  family: 0,   // cheap  (willingness $50)
  leisure: 1,  // middle (willingness $60)
  business: 2, // premium(willingness $90)
};

/** Multiplies the capture rate, indexed by hotel tier. */
export const TIER_DEMAND_MULT_PERMILLE: readonly number[] = [700, 1000, 1400];

/** PRICER's ceiling, indexed by hotel tier. A motel cannot charge $250. */
export const MAX_RATE_BY_TIER_MINOR: readonly number[] = [6_000, 12_000, 25_000];
export function maxRateForHotelTier(hotelTier: number): number;
export function isValidRateForHotelTier(rateMinor: number, hotelTier: number): boolean;
```

`capturePermille` gains a **fifth, optional** parameter
`tierMultPermille = 1000` (optional so the existing unit tests and their
pinned numbers keep compiling and passing unchanged); `arrivalsForDay`
gains a `hotelTier` parameter and (a) skips any segment whose
`SEGMENT_MIN_HOTEL_TIER` exceeds it and (b) passes
`TIER_DEMAND_MULT_PERMILLE[hotelTier]` into `capturePermille`. `isValidRate`
keeps its existing signature and behaviour; the tier-aware check is the
new function, and `applyPricerRate` calls the new one.

Note the interaction with `arrivalsForDay`'s existing "segments book
against the cheapest tier on offer" rule and with the fact that the
per-segment `rng.int` draws are the sim's RNG stream: **skipping a segment
must skip its draws too**, and the whole thing must stay deterministic
under sorted-key iteration. That is a stream change, and it is allowed —
every headless gate is re-pinned with `--verify-replay` this cycle
(VISION: "Sim additions are allowed and expected").

### 1.6 How the tier reaches the LEDGER view without a tenth top-level key

`ScreenViewData` is at exactly 9 of its 9-key budget (PLAN-ALPHA §4.4,
`screen-data.ts`'s header). **No tenth top-level key is added.** The
renovation facts ride inside the existing `ledger` key, which LEDGER
already reads:

```ts
export interface ScreenLedgerView {
  // ... existing 7 fields unchanged ...
  /** Hotel renovation tier, 0..2. */
  hotelTier: number;
  /** Cost of the NEXT renovation, or 0 at max tier. */
  renovateCostMinor: number;
  /** Stars required for the next renovation, or 0 at max tier. */
  renovateStarReq: number;
  /** True when the button would actually succeed if pressed at the desk. */
  renovateAvailable: boolean;
}
```

LEDGER now reads `ledger` + `ledgerDays` — still 2 keys, inside its
3-key allowance. AUDIT also reads `ledger` and is unaffected (it ignores
the new fields). PRICER's tier-aware ceiling likewise rides inside the
existing `pricing` key (`maxRateMinor` simply becomes tier-derived).

The renderer reads the tier from the `hotel` component directly, never
from the screen view.

### 1.7 The walkthrough's step list (fixed; W3 does not invent steps)

| id | Advances when | i18n key |
|---|---|---|
| `walk-to-desk` | player entity within `DESK_RADIUS_MM` of the desk | `walkthrough.desk` |
| `take-papers` | event `guest.presenting` | `walkthrough.papers` |
| `use-terminal` | event `screen.appOpened` | `walkthrough.terminal` |
| `check-in` | event `guest.checkedIn` | `walkthrough.checkin` |
| `clean-room` | event `room.messCleaned` | `walkthrough.clean` |
| `repair-prop` | event `prop.repaired` | `walkthrough.repair` |
| `run-audit` | event `econ.audit` | `walkthrough.audit` |
| `hire-clerk` | event `staff.hired` | `walkthrough.hire` |
| `renovate` | shown once `hotel.cash >= renovateCostMinor`; cleared by `hotel.renovated` | `walkthrough.renovate` |
| *(end card)* | event `hotel.renovated` with `to === 2` | `endcard.*` |

Steps are a strictly ordered list; a step whose advance condition is
already satisfied when it becomes current advances immediately (so a
player who does things out of order is never stuck behind a step they
already did). Nothing is timer-driven.

### 1.8 Ports, so two lanes never collide on a dev server

W1 → **5202**, W2 → **5203**, W3 → **5204**, W4 → **5205**. Never 5199
(`.claude/launch.json`'s port) and never 5173. `pkill` does not kill the
Windows dev server; use
`Get-NetTCPConnection -LocalPort <port> | Stop-Process`.

---

## 2. Lane summaries

### W1 — sim
Adds `hotel.tier`, the `hotel.renovate` command / effect / event,
tier-scaled demand and rate ceiling, the LEDGER RENOVATE button and its
view fields, and the `alpha-loop` headless scenario that plays the whole
arc with the owner bot and ends at tier 2, solvent, inside 14 in-game
days. Re-pins every headless golden with `--verify-replay`. Brief:
[briefs/W1-sim-tier-renovate.md](briefs/W1-sim-tier-renovate.md).

### W2 — motel-tier look
Threads a required `hotelTier` argument through `buildArchitecture`,
`buildDecor`, `buildFixtures`, `buildExterior` and `buildLighting`, adds
`procedural.ts` (canvas-generated stained carpet, scuffed flat paint,
ceiling tile, laminate, chain-link, asphalt, neon VACANCY), authors tier 0
in full, interpolates tier 1, and leaves **tier 2 byte-for-byte the look
ALPHA-LOOK.md verified**. Brief:
[briefs/W2-motel-tier-look.md](briefs/W2-motel-tier-look.md).

### W3 — walkthrough + end card
New `walkthrough.ts` (pure, event-driven, testable without a browser),
plus the HUD line and the end card in `hud.ts`, plus the strings in
`i18n.ts`. Skippable with one key; `pointer-events: none` throughout, so
it can never block input. Brief:
[briefs/W3-walkthrough-endcard.md](briefs/W3-walkthrough-endcard.md).

### W4 — artifact, fallback, hosting
`build-artifact.mjs` produces one self-contained HTML file ≤ 16 MB with
the four Kenney character GLBs and their `Textures/*.png` inlined as data
URIs behind a `fetch` shim, no external fetches at all;
`pointer-fallback.ts` gives hover-look when the sandbox refuses pointer
lock; `netlify.toml` publishes the same build. Brief:
[briefs/W4-artifact-packaging.md](briefs/W4-artifact-packaging.md).

---

## 3. Integration order

Lanes run concurrently but land in this order, one commit each, gates
re-run by the COO between landings (PLAN-ALPHA §6 rules 3, 4, 12):

1. **W1 first, always.** It is the only lane that moves `stateHash`; every
   other lane's verification is meaningless against a sim that is about to
   change. On landing, the COO re-runs the full headless sweep with
   `--verify-replay` and records the new hashes in the handoff.
2. **W3**, then **W2**. W3 is small and its wiring is additive; W2's
   wiring changes `syncScene`, which is the riskiest hunk in `main.ts`.
3. **W4 last**, because the artifact build consumes whatever `vite build`
   produces and must be measured against the final bundle.

If W1 slips, W2/W3/W4 still land — they do not depend on the tier existing
at compile time, because the tier reaches them only through main.ts
wiring, which the COO writes. Until W1 lands, the COO passes a literal
`2` where the tier goes, and the app renders exactly what it renders
today.

---

## 4. The exact `main.ts` wiring the COO will write

No lane writes any of this. Each brief states which of these hunks it
depends on, so a worker can reason about its own contract.

**(a) Read the tier from sim state each frame (invariant 4: hosts render,
sims decide).**

```ts
// near the other host mirrors, above the host object
import type { Hotel } from "./sim/components.js";
function readHotelTier(world: IWorld): number {
  for (const entity of world.entities()) {
    const hotel = world.getComponent<Hotel>(entity, "hotel");
    if (hotel) return hotel.tier;
  }
  return 0;
}
```

**(b) Rebuild scenery and the light rig on a tier change (W2).**
`ctx.scenery(key, create)` is get-or-create keyed by string
(`packages/renderer-three/src/three-host.ts`), so keying by tier gives a
built-once group per tier and a cheap visibility swap on change:

```ts
const sceneryByTier = new Map<number, THREE.Object3D>();
let lightingTier = -1;

syncScene(ctx, world, alpha) {
  const hotelTier = readHotelTier(world);
  const group = ctx.scenery(`hotel-t${hotelTier}`, () => {
    const g = new THREE.Group();
    g.add(buildArchitecture(floor, hotelTier));
    g.add(buildExterior(floor, hotelTier));
    g.add(buildFixtures(floor, hotelTier));
    g.add(buildDecor(floor, hotelTier));
    return g;
  });
  sceneryByTier.set(hotelTier, group);
  for (const [t, g] of sceneryByTier) g.visible = t === hotelTier;

  if (lightingTier !== hotelTier) {
    lightingRig?.dispose();
    lightingRig = buildLighting(floor, ctx.scene, ctx.renderer, hotelTier);
    lightingTier = hotelTier;
  }
  lightingRig.update(world, performance.now());
  // ... rest unchanged ...
}
```

W2's obligations that follow from this: every `build*` is a pure function
of `(floor, hotelTier)` with no module-level cache keyed on name alone,
and `LightingRig` grows a `dispose(): void` that removes its group from
the scene and disposes its lights.

**(c) Walkthrough + end card (W3).**

```ts
const walkthrough = createWalkthrough();
let lastEventIndex = 0;
window.addEventListener("keydown", (e) => {
  if (e.code === "KeyH" && !e.repeat) walkthrough.skip();
});
// inside the per-frame host callback, beside the existing hudState build:
const events = sim.eventsSince(0).slice(lastEventIndex);
lastEventIndex += events.length;
walkthrough.advance({
  tick: sim.tick,
  events,
  hotel: readHotel(world),
  nearDesk: playerNearDesk(world),
  renovateCostMinor: readRenovateCostMinor(world),
});
const hudState: HudState = {
  /* ... existing fields ... */
  walkthrough: walkthrough.current(),
  endCard: walkthrough.endCard(),
};
```

**(d) Pointer-lock fallback (W4).**

```ts
import { installHoverLookFallback } from "./render/pointer-fallback.js";
const canvas = document.getElementById("app") as HTMLCanvasElement;
installHoverLookFallback(canvas, {
  requestLock: () => canvas.requestPointerLock(),
  isLocked: () => document.pointerLockElement === canvas,
  onLook: (dx, dy) => controller.syntheticPointer.look(dx, dy),
  setLocked: (locked) => controller.syntheticPointer.lock(locked),
});
```

W4 must therefore export exactly that signature and must not import
`three`, `@claude-engine/player-fps`, or anything from `./sim/`.

**(e) `apps/hotel/package.json`** gains
`"build:artifact": "node scripts/build-artifact.mjs"` — COO-only.

---

## 5. COO review checklist, applied to every lane's output

Applied by the COO **re-running every command itself** (rule 12), not by
reading the lane's report.

1. **Globs.** `git status --porcelain` shows only paths inside the lane's
   declared globs. Any stray path halts the commit and is reconciled first.
2. **Build is clean from cold.** `rm -f apps/hotel/tsconfig.game.tsbuildinfo
   && rm -rf apps/hotel/dist-game`, then `npm run build`,
   `npx tsc -p apps/hotel/tsconfig.json --noEmit`, `npx eslint .`,
   `node scripts/check-purity.mjs` — all exit 0.
3. **Suites.** `npm test` (smoke hash **3849639990**, must not move — it
   is the engine demo, not the hotel) and
   `npm run test --workspaces --if-present`.
4. **Headless sweep, all with `--verify-replay`**: `smoke`, `demo-walk`,
   `bots-headless`, `walk-collide`, `corridor-headon`, `checkin-rush`,
   `fraud-catch`, `fraud-catch-b`, `zen-clean`, `first-hire`,
   `escalation-stars`, `one-man-week`, and (after W1) `alpha-loop`. Any
   **exit 3 is a P0** — replay divergence or a write-through violation —
   and is never answered by loosening an assertion.
5. **Browser gates** (`--browser --verify-replay`, and
   `--browser-engine firefox` for the two that run on both):
   `fps-look-interact`, `reserva-readability`, `save-restore`,
   `demo-visual`. Command counts must still be exactly 12 / 20 / 69 / 18 —
   a green streak over a varying count is not a pass.
6. **Non-vacuity is evidenced, not asserted.** The report must name the
   exact edit made, the exact assertion string that went red, and four
   exit codes (green → perturbed-red → rebuilt → green). A report without
   the red exit code is treated as "not verified" regardless of what it
   claims.
7. **Rebuild discipline was actually followed.** If a lane claims a
   perturbation without the `tsbuildinfo` + `dist-game` removal, the
   claim is void: `tsc` incremental skips rebuilding when only `dist`
   changed, so the "restore" is a no-op and the second green is the first
   green.
8. **Invariants.** No `Math.random`, no transcendental `Math.*` and no
   float in anything under `apps/hotel/src/sim`; every sim mutation goes
   through `setComponent`; no renderer module writes sim state; no new
   dev/debug path reachable from `index.html`'s bundle; every
   player-visible string goes through `t()`.
9. **Key budget.** `ScreenViewData` still has exactly 9 top-level keys.
10. **Tier 2 did not regress.** W2's tier-2 screenshots are compared
    against `apps/hotel/docs/evidence/alpha-look-*.jpg` by eye at full
    size, and the COO drives the real build once on a real GPU
    (`channel: "chrome"`, `--ignore-gpu-blocklist`) rather than trusting
    the harness's SwiftShader frames.
11. **"What you did NOT do."** Present and specific in every report. A
    lane that skipped a step and says so is fine; a lane that skipped a
    step silently is a re-run.
12. **The artifact is opened by the COO from `file://`, offline**, with
    the network panel confirming zero external requests, before W4 is
    called done.

---

## 6. Risks, each with its early-warning sign

| # | Risk | Early warning | Response |
|---|---|---|---|
| 1 | **The `alpha-loop` numbers do not converge** — the bot can afford tier 1 but never tier 2 in 14 days. | W1's first full run ends at tier 1 with cash climbing slowly. | Tune `RENOVATE_COST_MINOR[2]` and `TIER_DEMAND_MULT_PERMILLE[1]` — in the COO's hands, in one commit, after the lane reports actual closing cash per day. Never extend the 14-day budget. |
| 2 | **Stream change breaks a golden in a way that is a real bug, not a re-pin.** | `--verify-replay` exit 3 (not a changed hash — a *divergence*), or `stateHash` vs `stateHashSlow` disagreeing. | Stop. Exit 3 is a P0 write-through violation until proven otherwise; look for an in-place mutation of a fetched component in the new renovate path. |
| 3 | **Tier 2's look regresses while W2 is authoring tier 0.** | Any diff in `buildArchitecture`'s tier-2 path that is not a pure `if (hotelTier === 2) return <what it did before>` guard. | W2's non-vacuity obligation is explicitly the tier-2 identity check; the COO re-verifies with the evidence JPGs before merge. |
| 4 | **Scenery rebuild leaks GPU memory or drops the frame budget below `fps.avg ≥ 5`.** | `fps-look-interact`'s probe falling toward 5 after W2 lands; three groups alive at once. | Only three tiers exist and only two transitions ever happen per run, so three retained groups is the accepted ceiling; if the probe moves, the COO switches the visibility swap to a dispose-and-rebuild. |
| 5 | **The artifact exceeds 16 MB or silently fetches.** | `build-artifact.mjs` reporting > 12 MB, or any request in the network panel. | The PBR/HDRI payload (~90 MB) is *deliberately not* in the artifact: the artifact ships the four character GLBs only and everything else procedural. If size creeps, the GLBs go before the code does. |
| 6 | **Pointer lock is refused and hover-look is not equivalent**, so a play-tester cannot aim. | The fallback turning the camera at a different rate than real lock, or fighting it once lock succeeds. | The fallback must feed the same `syntheticPointer.look(dx, dy)` path (ALPHA-LOOK's trap: real mouse X is negated in `player-fps`'s DOM normalizer — the synthetic path keeps yaw-space meaning), and must disable itself the instant `isLocked()` is true. |
| 7 | **The walkthrough blocks input or shows up in the readability probe.** | `reserva-readability` moving at all. | HUD is already hidden entirely at `phase === "focused"`; W3's elements live inside `#hud` and inherit `pointer-events: none`. Any element W3 adds outside `#hud` is an automatic reject. |
| 8 | **Two lanes both want `main.ts`.** | A lane's report asking for a "small" edit there. | Contested; the COO writes it (§4). The lane reports the wiring it needs and stops (rule 5). |
| 9 | **A lane re-delegates instead of working.** | A report with no exit codes and no file diffs, arriving fast. | Rules 1 and 13: brief is re-issued to a fresh lane; the token spend is written off. |
| 10 | **`ScreenViewData` grows a tenth key by accident.** | Any new top-level field in `screen-data.ts`. | Hard reject; §1.6 is the answer and it is already written down. |

---

## 7. Open question for the CEO

Only one, and it is in §1.3: **MAX_STARS is 2** (`reviews.ts`), so a
three-star requirement for the Grand Foyer is unreachable without raising
the star ceiling, which moves `escalation-stars` and every star-derived
rule. Cycle 1 therefore gates both renovations at **2 stars and cash**.
If the CEO wants stars to be the felt gate for tier 2 rather than money,
raising `MAX_STARS` to 3 is a separate, escalated sim change and should be
its own lane in cycle 2.
