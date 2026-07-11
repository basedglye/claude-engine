---
name: worldforge
description: Build, extend, and verify games on ClaudeEngine — a deterministic TypeScript game engine with a headless playtest harness. Use when the user wants to create a game, add gameplay systems, generate procedural content, or playtest/verify game behavior with ClaudeEngine. Triggers on "make a game", "new game project", "add a gameplay system", "playtest", "game feel", "ClaudeEngine", "worldforge".
version: 0.0.1
---

# WorldForge — building games on ClaudeEngine

ClaudeEngine games are deterministic simulations rendered by thin hosts. To
build well on it, follow the invariants below and verify every change through
the harness — never by assumption.

## Architecture invariants

1. Game logic lives in sim systems (`packages/core` `Sim` + `System`
   functions). Sim code imports nothing from the DOM, Three.js, or Node.
2. All randomness comes from the sim's seeded `Rng` (fork per subsystem:
   `sim.rng.fork("loot")`). `Math.random()` is banned in sim code.
3. Hosts (renderer, server, harness) read state via `IWorld` and mutate only
   by submitting `Command`s.
4. Every run is reproducible from (seed, command log). If behavior can't be
   replayed, the change is wrong even if it looks right.
5. Use engine-provided netcode/persistence/auth. Do not hand-roll these.

## Workflow: creating a game

To scaffold a new game, copy a starter template (see `references/` when
available) into `apps/<game-name>/`, register its systems on a `Sim`, and
wire the web host with `startHostLoop` from `@claude-engine/renderer-three`.

## Workflow: verifying changes (do this before claiming anything works)

1. Write or extend a harness `Scenario` (`@claude-engine/harness`): seed,
   tick budget, scripted commands, assertions about end state and events.
2. Run it and read the JSON `Verdict`: per-assertion pass/fail, final state
   hash, perf stats, and a replay bundle (seed + commands) for any failure.
3. To reproduce a failure, replay its bundle with `replay()` from
   `@claude-engine/core` and bisect against per-tick state hashes.
4. For visual changes, additionally run the browser preview and capture a
   screenshot.

## Design guidance

- Prefer procedural generation (meshes, icons, audio synthesized from `Rng`
  streams) over static assets; keep any external assets inside the validated
  import pipeline.
- Keep systems small and data-driven; content (quests, NPCs, items) belongs
  in schema-validated data files, not code branches.
- Tune game feel against numbers (jump arc, input-to-response ticks), not
  adjectives — the harness reports them.
