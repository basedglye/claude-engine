# @claude-engine/audio

`Math.random` is legal in this package — it is presentation, not sim state, and CLAUDE.md invariant 2 (determinism through the seeded `Rng`) does not reach it.

Host-side procedural SFX + muzak layer for ClaudeEngine games. **Not a purity root.** It may import DOM/WebAudio types freely, is never scanned by `scripts/check-purity.mjs`, and must never be imported by any sim code (`packages/core`, `packages/space`, `packages/interiors`, `packages/surface-ui`, `packages/bots`, `packages/net`, or any `apps/*/src/sim` directory) — per docs/PHASE-H2.md section 7 rule 2: "Audio is host-side, full stop." No component ever records a sound fact; the sim's event stream (`Sim.eventsSince()`) is the one-way interface this package consumes.

## What it does

- `SynthSpec` / `SoundRule` — plain-data oscillator recipes and an event-type -> sound table, extending the oscillator approach already proven in `packages/assets/src/music.ts` + `packages/assets/src/web/audio.ts`.
- `createAudioHost(opts)` — builds an `AudioHost` that consumes `GameEvent`s each frame, schedules WebAudio nodes per matching `SoundRule` (positional via `PannerNode` for `at: "entity"` rules, direct-to-destination for `at: "ui"`), rate-limits per rule (`minIntervalMs`), and regenerates the ambient muzak score per star tier (`setMuzakTier`) via `@claude-engine/assets`' `generateScore`/`playScore`.
- `auditSoundCoverage(rules, gameplayEventTypes, deliberatelySilent)` — the completeness check the `audio-coverage` gate runs: every gameplay event type is either covered by a rule or explicitly marked deliberately silent; every rule's event type is a real, known gameplay event type. Nothing can be silently forgotten in either direction.

The hotel's concrete `SoundRule[]` table and `deliberatelySilent` list live at `apps/hotel/src/render/sounds.ts` (host side, not this package) — this package only ships the mechanism.

## Non-goals

No sample assets (off-style, outside the asset-synthesis stance — see `docs/PHASE-H2.md` section 5B "Rejected"). No audio state in components. No gate here asserts audible output; the `audio-coverage` gate is honest about that scope.
