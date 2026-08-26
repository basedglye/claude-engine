# GRAND FOYER — technical architecture

Status: adopted 2026-08-25. See [DESIGN.md](DESIGN.md) for the design bible
and [docs/ROADMAP-HOTEL.md](../../../docs/ROADMAP-HOTEL.md) for the phased
plan. Design rulings (depth escalation, pressure-vs-zen, meta-progression as
setup-ritual compression) live in DESIGN.md, not here.

**Engine reality check (verified 2026-08-25).** ClaudeEngine gives us: a
deterministic ECS-lite sim at a hardcoded 20 Hz, a seeded forkable `Rng`,
`snapshot`/`restore`/`replay`, `stateHash`, a Three.js render host, and a
headless+Playwright harness with JSON verdicts, `net`/`server`/
`persistence`/`bots`. It has **none** of: mouse input of any kind, pointer
lock, raycasting, collision, physics, pathfinding, animation/skinning, GLTF
loading, interior generation, UVs on generated meshes, in-world or DOM UI,
SFX/positional audio, or browser save/load. Interest management is a flat XZ
circle that ignores Y and sees through walls. Those gaps are the bulk of the
work, and per CLAUDE.md invariant 5 they become **engine packages**, not app
hacks.

## B1. Package plan

**New engine packages** (`packages/`):

| Package | Responsibility |
|---|---|
| `@claude-engine/space` | Deterministic spatial layer: integer-grid collision, portal graph (rooms/doors/floors), grid A* + portal routing, room queries, LOS. **Also hosts `sim-math`** (see B2). |
| `@claude-engine/player-fps` | Renderer-side FP/TP controller: pointer lock, mouse look, interaction reticle + raycast, input→CommandIntent, replayable input-trace format. |
| `@claude-engine/surface-ui` | Diegetic screen framework: OffscreenCanvas→CanvasTexture, retained widget tree, focus routing, UV→cursor mapping, embedded 8×8 bitmap font. |
| `@claude-engine/interiors` | Procedural interiors: BSP floorplan → WFC dressing → meshes **with UVs** + nav grid + portal graph from one source of truth; retro texture-atlas synthesis. |
| `@claude-engine/audio` | WebAudio host: procedural SFX bank, positional audio, ambience, event→sound table. |
| `@claude-engine/save-web` | Browser save/load: IndexedDB implementing the existing `GameStore` interface. |

**Changes to existing packages** (⚠ = public contract, needs a Fable
planning/review turn):

- ⚠ `core` — `despawn(entity)`, `componentsOf(entity)`, indexed/
  ring-buffered `eventsSince`, incremental dirty-tracked `stateHash`. All
  landed (H0 for the first three, H2a for the hash). Old APIs keep working;
  the hash's VALUES moved once, at the H2a re-pin, and its write-through
  requirement is now CLAUDE.md invariant 6.
- ⚠ `renderer-three` — `pointerHandlers` alongside the existing keyboard
  `keymap`, an `onFrame(camera)` hook, an `instancedScenery` helper, a
  texture cache, and synthetic-pointer injection in `installTestHook`.
- ⚠ `harness` — `browser.input` gains pointer steps (`lock` / `look{dx,dy}`
  / `click` / `screenClick{u,v}`) delivered through the test hook; new feel
  probes `sim-tick-ms`, `frame-time-p95`, `draw-calls`, `pointer-latency`.
- ⚠ `server` / `net` (Phase 5) — pluggable `InterestPolicy`, delta state
  messages (protocol v2), and serializing interest sets from live components
  instead of calling `Sim.snapshot()` per state message.
- `assets` — add optional `uvs` to `MeshData`. `bots` — guest/clerk/
  saboteur drivers.

**Stays in `apps/hotel`:** all hotel components/systems/commands, HOTELSOFT
apps built on `surface-ui`, content (archetypes, furniture catalog, economy
tuning), scenarios.

## B2. Determinism (BLOCKING finding — absorb into Phase 0)

Integer millimetres alone are **not** sufficient for determinism.
`Math.sin/cos/tan/atan2/exp/log/pow` are implementation-defined in
ECMAScript and differ across browsers, engine versions, and CPUs — and
converting a millidegree yaw to a movement vector needs trig. This would
silently break `--verify-replay` cross-machine and MP validation, at
boundary values, and get blamed on everything else first.

- All sim positions are integer **millimetres**; yaw is integer
  **millidegrees**. The renderer divides by 1000.
- `space/sim-math`: a fixed-point LUT `sin`/`cos` over millidegrees, integer
  `atan2` (octant LUT or CORDIC), integer `sqrt`. Sim code calls these,
  never `Math.*`.
- CI grep ban on `Math.` transcendentals inside sim packages (extends
  `scripts/check-purity.mjs`).
- `packages/assets` already uses `Math.sin/cos`; that's fine **only**
  because asset synthesis output must never be hashed into sim state — state
  this explicitly and audit `assets/src/mesh.ts` and `terrain.ts`.

## B3. Sim data model (`apps/hotel/src/sim`)

**No closure state, ever** (engine invariant 6 — a real Phase-3 bug):
`Sim.restore()` reruns `setup()` fresh, so any closure-cached Map starts
empty and silently drops replayed commands. Every lookup is derived by a
`withComponent` scan or by an indexing system that rebuilds an index
*component* each tick.

**Components:** `transform{x,y,z,yaw}`, `body{radius,height,solid}`,
`mobile{vx,vz,speed}`, `navAgent{path,pathIdx,goalCell,repathTick}`,
`person{kind,name,seed}`, `owner{actor}`, `role{job,skill,xp}`,
`staffed{schedule,wage,morale,quirk}`,
`guest{archetypeId,segment,patience,satisfaction,roomEntity,stayUntilTick,needs}`,
`roomUnit{roomId,floor,tier,state,quality}`, `door{portalId,locked,keyLevel,open}`,
`prop{kind,health,gripByEntity}`, `carryable`/`holding`,
`terminal{station,focusedBy}`, `screenApp{appId,state}`,
`document{docType,fields,heldBy}`, `reservation{...,flags}`,
`hotel{stars,cash,day,phase,repBySegment}` (singleton), `ledgerEntry`,
`interactable{verb,radiusMm,facing}`, `incident`, `review`, plus
`navIndex`/`roomIndex`/`actorIndex` singleton components rebuilt each tick.

**Systems, in registration (= execution) order:** `indexSystem` →
`commandRouter` → `guestSpawnSystem` → `guestBrainSystem` →
`staffBrainSystem` → `pathSystem` → `moveSystem` → `interactionSystem` →
`deskSystem` → `screenSystem` → `economySystem` → `incidentSystem` →
`reviewSystem` → `dayPhaseSystem` → `cleanupSystem`.

**Commands:** `move{dirX,dirZ,run}`, `face{yawMdeg}`, `interact{target}`,
`pickup`/`drop`/`place`, `screen.key`/`screen.cursor`/`screen.click{u,v}`,
`desk.decision{reservation,accept,roomId}`, `use{verb,target}`, plus
engine-reserved `@net/join|leave`.

**Events** (these *are* the assertion vocabulary and the audio trigger
table): `guest.arrived|checkedIn|checkedOut|complained|reviewed`,
`desk.fraudCaught|fraudMissed`, `incident.started|escalated|resolved`,
`econ.charge|expense|audit`, `staff.hired|quit|mistake`,
`screen.appOpened|actionTaken`, `player.roleXp`.

## B4. First-person layer

**The ruling: yaw is sim state, pitch is presentation.** Movement and
interaction facing use yaw only (interaction cones are 2D plus a vertical
band); pitch affects only what you look at, and "what you look at" is
resolved to an entity *by the host* before submitting `interact{target}`.
The host submits a quantized `face` command at most once per tick, when yaw
drift exceeds a threshold. So mouse look runs at monitor refresh while the
sim stays 20 Hz deterministic and the command log stays small.

*Rejected: pitch in sim with per-tick aim commands* — bloats the log, buys
nothing (there is no shooting).

- Pointer lock is requested on canvas click; ESC releases (and pauses in
  SP). Terminal focus releases look and maps the mouse to the screen surface
  instead.
- Interaction: the host raycasts camera → candidate → diegetic highlight →
  click submits `interact{target}`. **The sim revalidates proximity and
  facing via `interactable`; the raycast is a suggestion, never truth** —
  this is also the anti-cheat posture for MP.
- 1st/3rd toggle on `V`: a pure camera-rig change in `player-fps`; the
  third-person spring arm clamps against walls via a `space` occlusion
  query.
- **Testing without a mouse** (the harness has keyboard-only input):
  `player-fps` exposes `window.__WORLDFORGE__.input.pointer(step)`, injected
  *after* event normalisation so synthetic and real input share the exact
  code path. Because clicks still resolve through the real raycast against
  the real scene, this genuinely tests the pipeline. Real play sessions also
  record an input-trace replayable in CI — bug reports become fixtures.

## B5. Collision and navigation

- A per-floor uniform **250 mm grid**, cells hold a bitfield (solid | door |
  walkable | furniture), generated by `interiors` from the same floorplan
  that generates meshes — geometry and collision cannot desync. Circle-vs-
  grid axis-separated integer resolve.
- **No rigid-body physics in sim.** Slapstick (tumbling luggage) is
  presentation garnish triggered by sim events; the sim tracks only final
  resting cells.

  *Rejected: a deterministic physics engine* — comedy needs the look of
  physics, not the simulation of it.
- Two-level nav: a portal graph between rooms/corridors/stairs/elevators for
  coarse routing, grid A* only *within* the current room toward the next
  portal. Repath budget ≤10 A* per tick, round-robin by EntityId. Elevators
  are entities with schedules (and a comedy surface).
- **Deterministic symmetry-breaking is mandatory** (MAJOR finding): in an
  exactly-deterministic sim, two agents meeting head-on in a 1–2 cell
  corridor deadlock systemically — the real-world noise that normally breaks
  symmetry is absent. Rule: stable-EntityId priority (lower ID holds, higher
  yields) plus per-agent seeded cell-cost jitter from the sim RNG. Two Point
  Hospital's most-noticed failure was exactly this class of breakdown under
  load.
- The desk queue is an explicit `queueSlot` cell chain, not emergent
  crowding.
- Budget: 300 agents, most idle or on cached paths, so integer movement plus
  ≤10 bounded A* over ≤400-cell rooms stays comfortably under 2 ms/tick.
- Pre-vetted fallback if that fails at Phase 3 scale: `recast-navigation-js`
  (MIT, WASM Recast/Detour), **fixed-timestep only** — its maintainers state
  variable-timestep crowd sim is nondeterministic; WASM would need its own
  cross-platform determinism review first.

## B6. Interiors and art pipeline

- **BSP partition first, then WFC (or simple tile rules initially) per
  partition** — research shows this measurably beats WFC alone on
  valid/playable output rate, and the BSP adjacency graph *is* the portal
  graph handed to `space`. Generation-time validation (every room reachable,
  static stuck check) with deterministic reseed-on-failure.
- `HotelSpec{lot, floors, roomMix, seed}` → `{meshes, navGrid, portalGraph,
  propPlacements, lightAnchors}`. The same generator runs in sim setup (nav
  data only, pure) and in the host (meshes). Renovations are spec deltas
  stored in components and re-fed to the generator.
- UVs: planar per wall/floor quad at fixed texel density (~64 px/m).
- Retro textures: procedurally synthesised (noise + patterns + palette) →
  quantized to 32 colours + Bayer dither at 64–128 px → packed into one
  1024 px atlas per hotel (trivially inside the asset-pipeline gates).
- PS1 shader (well-documented Three.js techniques): vertex jitter — scale
  vertex xy then `floor()` to a coarse grid; affine warp — interpolate UVs
  in screen space without the perspective divide. **Both must exclude
  `surface-ui` screen quads while focused** — affine warp on the monitor
  would destroy text legibility. Look-lock (jitter grid size, warp on/off)
  is a Phase 2 exit criterion so later art isn't authored against a moving
  target.
- Lighting is baked into **vertex colours** at generation (corridor
  gradient, window falloff, lamp tint) — cheap, retro-correct,
  deterministic, and the engine has no shadow support anyway. A flickering
  lamp is emissive animation driven by prop health.
- Characters are **articulated Object3D limb hierarchies**, procedurally
  posed (walk bob, arm swing, carry, sit).

  *Rejected: adding GLTF + skinning to the engine* — large cost, off-style.
- Instancing per furniture kind per floor; walls merged into one static
  geometry per floor. Target < 300 draw calls.

## B7. The diegetic screen

- **Mechanism:** per-terminal OffscreenCanvas → `THREE.CanvasTexture` on a
  screen quad, redrawn only when `screenApp` state changes.

  *Rejected: `CSS3DRenderer`* — its content always draws on top of the WebGL
  canvas and never enters the depth buffer, so a monitor could not be
  occluded by a wall or by someone walking in front of it.

  *Rejected: Chrome's HTML-in-Canvas origin trial* — Chrome-only.

  *Rejected: `troika-three-text`* — worker-based async SDF atlas generation
  is nondeterministic relative to snapshots and its 2026 maintenance status
  is unverified; the bitmap font already covers the need.

  *Rejected: full-screen ortho swap* — breaks immersion; instead the camera
  eases toward the monitor on focus.
- **Readability is a first-class requirement** (MAJOR finding): the screen
  texture is **exempt from the atlas/palette pipeline** — rendered at native
  app resolution (≥ 640×480), nearest-neighbour, mips disabled while
  focused. If HOTELSOFT is unreadable the entire management layer is dead.
  Phase 1 exit includes a screenshot readability check at the focused camera
  pose (≥ 1 texel per glyph pixel for the 8×8 font).
- **Sim purity:** all app *state* lives in the `screenApp` component and
  mutates only via `screen.*` commands processed by `screenSystem`. The
  painter is a pure host-side function of that state. Consequence:
  **headless assertions read components, not pixels** — "PRICER shows rate
  120" is a component assertion. Pixel diffs are optional smoke tests.
- App shape: `{id, reduce(state, input, worldView), paintSpec(state)}`;
  `reduce` runs in sim, `paintSpec` is interpreted by the host. Widgets:
  panel/list/button/textfield/table, embedded 8×8 bitmap font (canvas text
  rendering is platform-nondeterministic in screenshots — and maximally
  retro besides).
- **RESERVA's check-in validation is a data-driven rule table from day
  one**, not hardcoded fraud branches — the Phase 3+ protocol-escalation
  system depends on it (see DESIGN.md "Depth escalation for the terminal
  loop").
- Input routing: `interact` on a terminal sets `terminal.focusedBy` → the
  host enters screen focus, pointer unlocked-but-captured, mouse position
  mapped through the quad UV → `screen.cursor/click{u,v}`; keyboard →
  `screen.key`. ESC releases. Rate-limited via server command rules in MP.
- CCTV: host-side render-to-texture at 4 fps / 160×120, heavily dithered
  (atmospheric *and* cheap). The sim knows only which cells a camera covers,
  via `space` LOS, for detection logic.

## B8. Audio, persistence, performance

**Audio** (`@claude-engine/audio`): a procedural SFX synth bank extending
the existing oscillator approach (footsteps by floor material, bell ding,
keyboard clacks, door creaks, crashes, muzak), PannerNode positional audio
with the camera as listener, and an `eventSoundTable: Record<eventType,
soundSpec>` fed by `eventsSince`. Elevator-music quality tracks star rating
— a joke and a progression signal. Verification is event-stream correctness;
the sim knows nothing of audio.

**Persistence:** `save-web` implements the *existing* `GameStore` interface
over IndexedDB — append commands per tick (batched, flush on visibility
change), snapshot every ~2000 ticks and at every night audit, load via the
same `recoverSim()` the server uses. Export/import a save as JSON: shareable,
and it doubles as a bug-report replay. SP→MP migration becomes "point the
store elsewhere". Server side keeps `persistence` as-is; long runs later
need a ⚠ `GameStore.compact()`.

**Performance budgets** (measured by the new feel probes, gated in
verdicts): sim tick ≤ 5 ms at 300 entities; browser frame-time p95 ≤ 16.7
ms; ≤ 300 draw calls; server state-message serialisation ≤ 3 ms/actor. Fix
order:

1. Indexed/ring-buffered `eventsSince` — Phase 0. **Done.**
2. Incremental `stateHash` with the full JSON hash kept as a `--verify` slow
   path — Phase 2. **Done in H2a**, and the slow path is not merely kept: the
   harness asserts `stateHash() === stateHashSlow()` on every run, live and
   replayed, because the incremental hash's correctness now rests on a house
   rule (write-through) rather than on arithmetic. Measured at a 300-entity
   fixture: 6x cheaper than the full walk, below the 10x the H2 spec
   expected — reported as measured.
3. Merged static geometry + instancing + one atlas — Phase 2.
4. `despawn` plus "off-screen guests are rows in a demand table, not
   entities" — Phase 0/2.
5. Server serialises interest sets from live components, no
   `Sim.snapshot()` in the message path — Phase 5.
6. Delta messages, protocol v2 — Phase 5.

## B9. Multiplayer architecture

- **SP *is* the MP sim from day one.** The hotel sim is written against
  actor-bound commands even in SP; SP rival hotels are the same `hotel`
  entities MP players will own, driven by a `rivalAiSystem` that MP simply
  doesn't register. The `commands` validation rule table is a shared
  module. Server integration becomes configuration, not a rewrite. Warning
  sign to watch for: any sim code that reads "the player" as a singleton
  rather than by actor.
- **Interest = room/portal graph** (⚠ new `InterestPolicy`): current room +
  rooms through open portals at depth 1 + LOS through open doors. Your own
  finances replicate through your terminal apps; a rival's never do. Someone
  entering your hotel produces a "presence blip" — you learn *that*, not
  *who*, unless CCTV covers it. CCTV extends interest to covered rooms of
  *your own* hotel only. This makes wallhacks structurally impossible: the
  server never sends what a wall hides. The existing `radiusInterest` is a
  flat XZ circle that ignores Y entirely — for a multi-floor hotel it is
  both wrong and, in a game about spying, a free ESP hack.
- Everything is authoritative; predicted (via the existing net overlay): own
  movement, doors, pickup. **Screen apps are not predicted** — 100–200 ms
  latency on a 90s terminal is diegetic comedy, and it avoids predicting
  economy state.
- Anti-cheat: the fiction is cheating *in-world*, so the rule is simply that
  **all rival knowledge must arrive through the interest policy**. Plus the
  server-side command rule table (rates, range checks — no `interact` across
  the map), intent-based movement (never client-supplied positions), and
  replay-audit on report. Espionage *detection* is gameplay (suspicion AI),
  not netcode.
- One Node `startGameServer` per street (8 hotels ≈ 1–2k entities, fits one
  sim); a thin lobby maps users → streets.
- Preconditions before MP starts: B8 items 5–6 done, interest policy done,
  browser save battle-tested, command rule table complete, soak green at 8
  bots × 2k entities.

## B10. Testing and verification

- Scenarios live in `apps/hotel/scenarios/`. Assertion helpers: `occupancy`,
  `cash`, `eventsOfType`, `guestSatisfied`, `noStuckAgents` (no `navAgent`
  on an unchanged cell for > N ticks), `screenState(terminal, appId)`,
  `ledgerBalances` (double-entry check), `fraudOutcome`.
- Bots: `guestBot`, `clerkBot` (reads `screenApp` + `document` components,
  decides accept/deny with a configurable error rate), `saboteurBot` (MP).
- New feel probes: `sim-tick-ms`, `frame-time-p95`, `draw-calls`,
  `pointer-latency`.
- Every phase exit requires its named scenarios passing with
  `--verify-replay`; rendering-relevant phases add `--browser` + screenshots;
  MP phases add `--soak` and `net` scenarios.
- Two gates worth naming now: `fps-look-interact` (synthetic pointer looks
  at a door, clicks, asserts `door.open` flipped in sim — proves the whole
  raycast→command→sim path headlessly) and the Phase 5 interest gate (a bot
  in a corridor receives **zero** components of entities behind closed
  doors, asserted on the wire).

## B11. Hosting from this PC

Dev: `npm run dev -w apps/hotel` (Vite) plus the harness plus the Claude
Browser preview. SP ships as a static bundle. Exposure options: **Cloudflare
Tunnel (recommended)** — free, no port forwarding, stable named URL,
survives CGNAT; Tailscale Funnel (simplest, bandwidth-limited); router
port-forward + DDNS (free, fragile, exposes home IP). MP server runs as a
Node process behind the same tunnel (wss passes through),
`ticketAuth(hmacSecret)` with a small invite-token page, SQLite locally. One-
command `npm run host` builds, starts server + static, and prints the tunnel
URL. Honest tradeoff: home-PC hosting means the street sleeps when the PC
does — acceptable, because the design already assumes non-persistent
streets.
