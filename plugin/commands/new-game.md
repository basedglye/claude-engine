---
name: new-game
description: Scaffold a new ClaudeEngine game from a starter template and verify it out of the box.
---

Scaffold a new game and prove it works before touching any code.

1. Ask the user for an app name (kebab-case) and which template fits their
   request — `3d-world` (perspective camera, terrain, procedural props) or
   `topdown-2d` (orthographic camera, grid movement, icon sprites). Default
   to `3d-world` if the request doesn't clearly imply top-down/2D.
2. Run:
   ```bash
   npm run scaffold --silent -- <app-name> --template <3d-world|topdown-2d>
   npm install
   ```
3. Verify the scaffold is genuinely playable and agent-verifiable before
   reporting success — this is the harness workflow, not optional polish:
   ```bash
   npm run build --workspace @claude-engine/<app-name>
   npm run harness --silent -- apps/<app-name>/scenarios/first-run.scenario.mjs
   npm run harness --silent -- apps/<app-name>/scenarios/first-run.scenario.mjs --browser
   ```
   Both must exit 0. If either fails, something is wrong with the scaffold
   itself — stop and investigate rather than proceeding to edit game logic
   on top of a broken base.
4. Point the user at `apps/<app-name>/README.md` and the `worldforge` skill's
   `references/templates.md` for how to extend what was just scaffolded, and
   at `references/harness-api.md` for the verification loop to use on every
   subsequent change.
