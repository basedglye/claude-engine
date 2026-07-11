# Research synthesis — what we learned before building ClaudeEngine

Compiled 2026-07-11 from three parallel research passes (World of Claudecraft
deep-dive; Fable-5-era showcase projects; Claude game-dev tooling ecosystem).

## 1. World of Claudecraft — the benchmark to beat

Browser MMORPG by Levy Street (NZ), built in 48 hours with Claude Fable 5 for
~$1,000 in API usage. 9 classes, 3 zones, ~80 quests, dungeons, a raid boss,
PvP, economy, 12 languages. Open-sourced: 1000+ stars, ~300 forks, 30+
contributors. ([site](https://worldofclaudecraft.com),
[repo](https://github.com/levy-street/world-of-claudecraft),
[HN](https://news.ycombinator.com/item?id=48509143),
[cost/value analysis](https://chiragvadhia.substack.com/p/world-of-claudecraft-an-mmo-for-1000))

**What made it work (adopt and generalize):**
- *"One sim, three hosts"*: one deterministic TypeScript sim (fixed 20 Hz
  tick, seeded `Rng`, zero DOM/Three.js imports) runs in an offline browser
  build, an authoritative Postgres-backed server, and a headless Python RL
  environment. Renderer depends only on an `IWorld` interface.
- *Procedural everything*: terrain, creatures, spell icons, and even the
  soundtrack (written in TypeScript) generated at runtime — almost no static
  assets.
- *A strict CLAUDE.md* enforcing the above, which is what kept 30+
  contributors and an autonomous agent loop coherent.
- *Post-launch agent loop*: an agent watches Discord for requests/bugs,
  implements, tests against bot players, opens PRs for human review.

**What drew criticism (our openings):** netcode scalability, database
architecture under load, security/auth hardening, thin error handling.
Consensus takeaway: the durable value is in feedback loops and conventions,
not generated code. ([Notebookcheck critique](https://www.notebookcheck.net/World-of-ClaudeCraft-AI-builds-MMO-in-2-days-here-s-why-gamers-aren-t-impressed.1327938.0.html))

## 2. The wider Fable-5 landscape

- Anthropic's Fable 5 showcase: 57 self-contained web demos built by agents
  in a day. Community: Minecraft clones in 20–55 min (~$12 API), a
  mechanically-accurate Swiss watch movement in Three.js, SimRefinery
  reverse-engineered from screenshots, shader worlds, etc.
- Closest prior art to ClaudeEngine, and why none of it is ClaudeEngine:
  - **Claude Code Game Studios** (49 agents / 72 skills): a *process*
    framework — no runtime, nothing enforces architecture at the code level.
  - **Summer Engine**: AI-native Godot-4-compatible engine with Claude in the
    engine loop (run → read errors → fix). Proves the in-loop thesis, but
    it's a proprietary desktop product, not an open skill + library.
  - **SkillsWeaver**: D&D tabletop engine — narrative, not a game runtime.
- Documented Fable-era failure modes to design around: token burn, overly
  eager/over-complex generated code, weak generated security/netcode, and
  "confidently incorrect but tests pass."

## 3. Tooling ecosystem (2026): what exists vs. what's missing

**Exists and is mature:** engine MCPs (Godot 95+ tools, Unity 5.8k-star
community MCP, Unreal community MCP, Blender MCP for assets), Playwright MCP
for browser control/screenshots, image-gen MCPs, the Skills/Plugins spec
(progressive disclosure, `SKILL.md` + `scripts/`/`references/`/`assets/`),
Agent SDK (subagents, hooks, sessions, MCP). Three.js dominates web 3D
(~5.4M weekly downloads, WebGPU default since r171); WebGPU shipped in all
major browsers by late 2025.

**Identified gaps (ClaudeEngine's build list):**
1. Headless playtest harness with structured agent-readable output — the #1
   gap; nothing closes the loop for web games the way Summer Engine does for
   Godot.
2. Live debug/error streaming formatted for agent consumption.
3. Asset import + validation pipeline (generated assets aren't game-ready).
4. Game-feel analysis (nothing rates "floaty jump"; tuning is human taste).
5. Last-mile system integration testing (10 generated systems ≠ one game).
6. Agent governance: change tracking, approval gates, rollback for
   agent-driven live games.

## 4. Strategic conclusion

Nobody has shipped an **open, reusable runtime engine + Claude Code skill**
where the engine's architecture is designed for agent development and the
verification loop is built in. Claudecraft proved the conventions work once;
Summer Engine proved the in-loop feedback thesis in a closed product.
ClaudeEngine = those two proofs, unified, open, and distributable as a plugin.
