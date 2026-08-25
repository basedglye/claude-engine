/**
 * Browser-mode harness (docs/PHASE-2.md Scope E) — drives a real render host
 * via Playwright, capturing screenshots, console/page errors, and game-feel
 * probes. Playwright is an optional peer dependency: this module is only
 * imported (dynamically) by the CLI when --browser is passed, so headless
 * harness usage stays Playwright-free.
 *
 * Determinism note: wall-clock keyboard input lands on nondeterministic
 * ticks, so a browser run is NOT reproducible by re-running it — but the
 * test hook (packages/renderer-three/src/test-hook.ts) records every
 * command it submits, and that log becomes this run's replay bundle. A
 * browser session is therefore reproducible *headlessly* via `--replay`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CALIB_RECT } from "@claude-engine/surface-ui";
import type { Scenario } from "./index.js";
import { analyzeReadability, decodePng } from "./screen-readability.js";

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export type InputStep =
  | { key: string; downMs: number; upMs: number } // existing, wall-clock
  // Tick-gated form (docs/PHASE-H0.md risk 4's mitigation, phase-H0 review
  // item 1): down/up are dispatched once window.__WORLDFORGE__.world.tick
  // reaches the given tick, via the same polling approach as screenshot
  // capture (see pollUntilTick). Removes the wall-clock-vs-sim-tick
  // scheduling variance at the source for scenarios that need an exact,
  // reproducible tick count under a held key (e.g. a deterministic number
  // of move ticks before a corrective look + click).
  | { key: string; downAtTick: number; upAtTick: number }
  | { pointer: "lock"; atMs: number }
  | { pointer: "lock"; atTick: number }
  | { pointer: "look"; atMs: number; dx: number; dy: number } // px deltas
  | { pointer: "look"; atTick: number; dx: number; dy: number }
  | { pointer: "click"; atMs: number }
  | { pointer: "click"; atTick: number }
  // screenClick (docs/PHASE-H1.md Scope D): tick-gated form only. The
  // wall-clock form stays RESERVED/exit 2 — H0 deferral rule 6 bans new
  // wall-clock steps, and H1 restates it explicitly for this one.
  | { pointer: "screenClick"; atMs: number; u: number; v: number } // RESERVED: exit 2
  | { pointer: "screenClick"; atTick: number; u: number; v: number };

export interface BrowserSpec {
  /** Workspace name (e.g. "@claude-engine/demo") — harness builds it and
   *  serves via vite preview — or an http(s):// URL to use as-is. */
  app: string;
  /** Input script driven by Playwright: wall-clock steps (existing) and/or
   *  tick-gated steps (see InputStep). Wall-clock steps keep their existing
   *  scheduler (sorted by atMs, replayed against real elapsed time) so
   *  older scenarios (e.g. demo-visual) are unaffected; tick-gated steps
   *  run as a separate sequential queue, each waiting for its declared sim
   *  tick before firing, processed in declaration order. Both queues run
   *  concurrently (see runInputScript) — a scenario would normally use one
   *  kind or the other, not mix them. */
  input?: readonly InputStep[];
  /** Sim ticks (via the test hook) at which to capture screenshots. */
  screenshotAtTicks?: readonly number[];
  probes?: readonly ProbeSpec[];
  /** Abort (exit 2) if the run exceeds this. Default 30_000. */
  timeoutMs?: number;
}

export type ProbeSpec =
  | { probe: "fps"; sampleMs?: number }
  | { probe: "input-latency"; key: string; component: string; samples?: number }
  | { probe: "sim-tick-ms"; minSamples?: number }
  // docs/PHASE-H1.md "Readability as a gate": analyses the already-captured
  // screenshot (the most recently captured one, per screenshotAtTicks — no
  // second capture) at the focused screen's projected pose. `appId` is
  // carried for report/debugging symmetry with other probes; the analysis
  // itself only needs the hook's screenRect() and the screenshot bytes.
  | { probe: "screen-readability"; appId: string };

export interface BrowserRunReport {
  app: string;
  url: string;
  /** Always false: wall-clock input -> nondeterministic ticks. Reproduce
   *  headlessly via the captured replay bundle + --replay. */
  deterministic: false;
  finalTick: number;
  finalStateHash: number;
  screenshots: { requestedTick: number; actualTick: number; path: string }[];
  consoleErrors: string[];
  pageErrors: string[];
  probes: Record<string, Record<string, number>>;
  feelChecks: { target: string; value: number; passed: boolean }[];
}

/** Thrown for infra failures (build/serve/hook timeout/missing Playwright) — CLI maps this to exit 2. */
export class BrowserInfraError extends Error {}

export interface BrowserRunResult {
  browser: BrowserRunReport;
  commands: { tick: number; actor: string; type: string; payload?: unknown }[];
  eventCount: number;
  entityCount: number;
  passed: boolean;
}

export type BrowserEngine = "chromium" | "firefox";

export async function runBrowserScenario(
  scenario: Scenario,
  repoRoot: string,
  opts: { screenshotDir?: string; browserEngine?: BrowserEngine } = {}
): Promise<BrowserRunResult> {
  const spec = scenario.browser as BrowserSpec | undefined;
  if (!spec) {
    throw new BrowserInfraError(`Scenario "${scenario.name}" has no browser spec (scenario.browser is required for --browser).`);
  }
  const engine: BrowserEngine = opts.browserEngine ?? "chromium";

  // screenClick's wall-clock form stays reserved (H0 deferral rule 6 bans
  // new wall-clock steps; docs/PHASE-H1.md restates it for this one). The
  // tick-gated form is implemented below.
  for (const step of spec.input ?? []) {
    if ("pointer" in step && step.pointer === "screenClick" && "atMs" in step) {
      throw new BrowserInfraError(
        '"screenClick" input steps only support the tick-gated form ({ atTick, u, v }) — the wall-clock form stays reserved.'
      );
    }
  }

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    throw new BrowserInfraError(
      "Playwright is not installed. Run `npm install` at the repo root, then `npx playwright install chromium`."
    );
  }

  const timeoutMs = spec.timeoutMs ?? 30_000;
  const screenshotDir = resolve(
    repoRoot,
    opts.screenshotDir ?? join("artifacts", "harness", scenario.name)
  );
  mkdirSync(screenshotDir, { recursive: true });

  const { url, cleanup } = await resolveAppUrl(spec.app, repoRoot);

  // A start barrier (phase-H0 round-2 review, blocking item 1) is needed
  // whenever the scenario has any tick-gated input step: those steps
  // (downAtTick/upAtTick, atTick) only mean a deterministic sim tick if
  // the app hasn't already stepped past it before the input script gets a
  // chance to poll for it. Wall-clock-only scenarios (demo-visual,
  // demo-walk) never set this, so the app is never asked to pause and
  // behaves exactly as before this change.
  const needsStartBarrier = (spec.input ?? []).some((step) => "downAtTick" in step || "atTick" in step);
  // Always hand the app the scenario's seed. Without this the app runs
  // whatever seed it hardcodes while the headless replay uses the
  // scenario's, so the two run DIFFERENT WORLDS and the only symptom is
  // exit 3 (replay divergence) with nothing pointing at the cause. That
  // cost a full debugging session once; the guard below makes a mismatch
  // impossible to ship silently.
  let navUrl = withQueryParam(url, "worldforgeSeed", scenario.seed);
  if (needsStartBarrier) navUrl = withQueryParam(navUrl, "worldforgeStartPaused", "1");

  // Headless Chromium's default GL backend fails to compile Three.js's
  // shaders on many CI/sandboxed machines (shader VALIDATE_STATUS false ->
  // WebGL context loss -> a blank canvas with no console error to explain
  // it). ANGLE-over-SwiftShader is a reliable software rasterizer fallback.
  // Firefox does not take these flags — they are Chromium-only.
  let browser: import("playwright").Browser;
  try {
    browser =
      engine === "firefox"
        ? await playwright.firefox.launch({ headless: true })
        : await playwright.chromium.launch({
            headless: true,
            args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
          });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/Executable doesn't exist|browserType\.launch/.test(message)) {
      throw new BrowserInfraError(
        `Playwright's ${engine} browser binary is not installed. Run \`npx playwright install ${engine}\`.\n${message}`
      );
    }
    throw err;
  }
  try {
    const page = await browser.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const deadline = Date.now() + timeoutMs;
    await page.goto(navUrl, { timeout: timeoutMs });

    try {
      await page.waitForFunction(() => Boolean((window as unknown as { __WORLDFORGE__?: unknown }).__WORLDFORGE__), {
        timeout: Math.max(1000, deadline - Date.now()),
      });
    } catch {
      throw new BrowserInfraError(`Test hook (window.__WORLDFORGE__) did not appear within ${timeoutMs}ms at ${url}.`);
    }

    const tickRateHz = await page.evaluate(
      () => (window as unknown as { __WORLDFORGE__: { info: { tickRateHz: number } } }).__WORLDFORGE__.info.tickRateHz
    );

    const hasPointerStep = (spec.input ?? []).some((s) => "pointer" in s);
    if (hasPointerStep) {
      const hookHasPointer = await page.evaluate(
        () => Boolean((window as unknown as { __WORLDFORGE__: { pointer?: unknown } }).__WORLDFORGE__.pointer)
      );
      if (!hookHasPointer) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" has pointer input steps, but the app's test hook exposes no ` +
            `"pointer" (window.__WORLDFORGE__.pointer). The app must pass a SyntheticPointer to installTestHook.`
        );
      }
    }
    // Matches the pointer precedent exactly: a specific slot check (not just
    // the generic hookHasPointer above) for screenClick, since a hook can
    // have a pointer with click/look/lock but no screenClick.
    const hasScreenClickStep = (spec.input ?? []).some((s) => "pointer" in s && s.pointer === "screenClick");
    if (hasScreenClickStep) {
      const hookHasScreenClick = await page.evaluate(
        () =>
          typeof (window as unknown as { __WORLDFORGE__: { pointer?: { screenClick?: unknown } } }).__WORLDFORGE__.pointer
            ?.screenClick === "function"
      );
      if (!hookHasScreenClick) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" has screenClick input steps, but the app's test hook's pointer exposes no ` +
            `"screenClick" (window.__WORLDFORGE__.pointer.screenClick). The app must pass a SyntheticPointer with a ` +
            `screenClick slot to installTestHook (see @claude-engine/player-fps's "screen" controller option).`
        );
      }
    }

    const wantsScreenReadability = (spec.probes ?? []).some((p) => p.probe === "screen-readability");
    if (wantsScreenReadability) {
      const hookHasScreenRect = await page.evaluate(
        () => typeof (window as unknown as { __WORLDFORGE__: { screenRect?: unknown } }).__WORLDFORGE__.screenRect === "function"
      );
      if (!hookHasScreenRect) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" requests the "screen-readability" probe, but the app's test hook exposes no ` +
            `"screenRect" (window.__WORLDFORGE__.screenRect). The app must pass a screenRect() function to installTestHook.`
        );
      }
    }

    const wantsTickTimings = (spec.probes ?? []).some((p) => p.probe === "sim-tick-ms");
    if (wantsTickTimings) {
      const hookHasTickTimings = await page.evaluate(
        () => typeof (window as unknown as { __WORLDFORGE__: { tickTimings?: unknown } }).__WORLDFORGE__.tickTimings === "function"
      );
      if (!hookHasTickTimings) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" requests the "sim-tick-ms" probe, but the app's test hook exposes no ` +
            `"tickTimings" (window.__WORLDFORGE__.tickTimings). The app must pass a tickTimings() function to installTestHook.`
        );
      }
    }

    // The app must actually be running the scenario's world. If it ignored
    // ?worldforgeSeed the browser run and the headless replay describe
    // different worlds, and the only symptom would be exit 3 with no cause
    // named — a silent trap that has already cost one long debugging
    // session. Fail loudly and say exactly what to wire instead.
    {
      const liveSeed = await page.evaluate(
        () => (window as unknown as { __WORLDFORGE__: { world: { seed: string } } }).__WORLDFORGE__.world.seed
      );
      if (liveSeed !== scenario.seed) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" declares seed "${scenario.seed}" but the app is running seed ` +
            `"${liveSeed}". The harness navigated with ?worldforgeSeed=${scenario.seed}; the app must read ` +
            `that query parameter and construct its Sim with it. Left unfixed, the browser run and the ` +
            `headless replay of its command log are different worlds and the run fails as a replay divergence.`
        );
      }
    }

    if (needsStartBarrier) {
      const hookHasBarrier = await page.evaluate(
        () => Boolean((window as unknown as { __WORLDFORGE__: { startBarrier?: unknown } }).__WORLDFORGE__.startBarrier)
      );
      if (!hookHasBarrier) {
        throw new BrowserInfraError(
          `Scenario "${scenario.name}" has tick-gated input steps, but the app's test hook exposes no ` +
            `"startBarrier" (window.__WORLDFORGE__.startBarrier) even though the harness navigated with ` +
            `?worldforgeStartPaused=1. The app must read that query flag and pass startPaused: true to installTestHook.`
        );
      }
    }

    const screenshots: { requestedTick: number; actualTick: number; path: string }[] = [];
    const requestedTicks = [...(spec.screenshotAtTicks ?? [])].sort((a, b) => a - b);
    const targetTick = requestedTicks.length > 0 ? requestedTicks[requestedTicks.length - 1]! : undefined;

    // Release the start barrier is handed to runInputScript rather than
    // called here, and NOT called before the tick-0-gated steps are
    // dispatched. An earlier version released here, before runInputScript
    // even started: that leaves a race between "release() resolves" and
    // "the tick-0 keydown/pointer step's page.evaluate round-trip actually
    // lands" -- the sim is free-running as soon as it's released, so on a
    // slower round-trip (observed on Firefox, not Chromium) the sim can
    // take its first step BEFORE the tick-0 dispatch arrives, and the
    // first move command lands on tick 2 instead of tick 1. A keydown /
    // pointer-lock / look / click is a state change, not a tick-bound
    // event, so it is correct AND safe to apply it while the sim is still
    // paused at tick 0 -- runInputScript now does exactly that: dispatch
    // every atTick/downAtTick === 0 step synchronously while paused, THEN
    // release, THEN run the remaining wall-clock/tick queues as before. If
    // release itself fails, that is an infra failure, not a scenario
    // failure -- runInputScript surfaces it as a BrowserInfraError rather
    // than leaving the sim hung paused forever.
    const releaseBarrier = needsStartBarrier
      ? async (): Promise<void> => {
          try {
            await page.evaluate(() => {
              const hook = (window as unknown as { __WORLDFORGE__: { startBarrier?: { release(): void } } }).__WORLDFORGE__;
              hook.startBarrier?.release();
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new BrowserInfraError(`Failed to release the start barrier for scenario "${scenario.name}": ${message}`);
          }
        }
      : undefined;

    // Drive the wall-clock input script in real time.
    const inputDone = runInputScript(page, spec.input ?? [], deadline, releaseBarrier);

    // Capture screenshots as the sim crosses each requested tick.
    let nextIdx = 0;
    while (nextIdx < requestedTicks.length && Date.now() < deadline) {
      const requestedTick = requestedTicks[nextIdx]!;
      const actualTick = await pollUntilTick(page, requestedTick, deadline);
      const filePath = join(screenshotDir, `tick-${requestedTick}.png`);
      await page.screenshot({ path: filePath });
      screenshots.push({ requestedTick, actualTick, path: filePath });
      nextIdx++;
    }
    await inputDone;

    // If the input script or screenshots didn't already carry us to the
    // scenario's tick count, give the sim a moment to settle.
    if (targetTick !== undefined) {
      await pollUntilTick(page, targetTick, deadline).catch(() => undefined);
    }

    const probeResults: Record<string, Record<string, number>> = {};
    for (const p of spec.probes ?? []) {
      probeResults[p.probe] = await runProbe(page, p, tickRateHz, deadline, screenshots);
    }

    const feelChecks: { target: string; value: number; passed: boolean }[] = [];
    for (const [key, bounds] of Object.entries(scenario.feelTargets ?? {})) {
      const value = lookupProbeValue(probeResults, key);
      const passed = value !== undefined && (bounds.min === undefined || value >= bounds.min) && (bounds.max === undefined || value <= bounds.max);
      feelChecks.push({ target: key, value: value ?? Number.NaN, passed });
    }

    const finalState = await page.evaluate(() => {
      const hook = (window as unknown as {
        __WORLDFORGE__: {
          world: { tick: number; stateHash(): number; eventsSince(t: number): unknown[]; entities(): Iterable<number> };
          commandLog(): { tick: number; actor: string; type: string; payload?: unknown }[];
        };
      }).__WORLDFORGE__;
      return {
        tick: hook.world.tick,
        stateHash: hook.world.stateHash(),
        eventCount: hook.world.eventsSince(0).length,
        entityCount: [...hook.world.entities()].length,
        commands: hook.commandLog(),
      };
    });

    const hookReachedTicks = targetTick === undefined || finalState.tick >= targetTick;
    const allScreenshotsCaptured = screenshots.length === requestedTicks.length;
    const noErrors = consoleErrors.length === 0 && pageErrors.length === 0;
    const feelOk = feelChecks.every((f) => f.passed);
    const passed = hookReachedTicks && noErrors && allScreenshotsCaptured && feelOk;

    return {
      browser: {
        app: spec.app,
        url,
        deterministic: false,
        finalTick: finalState.tick,
        finalStateHash: finalState.stateHash,
        screenshots,
        consoleErrors,
        pageErrors,
        probes: probeResults,
        feelChecks,
      },
      commands: finalState.commands,
      eventCount: finalState.eventCount,
      entityCount: finalState.entityCount,
      passed,
    };
  } finally {
    await browser.close();
    cleanup();
  }
}

/** Append (or overwrite) a query param on a URL string, whether or not it
 *  already has a query string. */
function withQueryParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

async function pollUntilTick(
  page: import("playwright").Page,
  tick: number,
  deadline: number
): Promise<number> {
  let last = 0;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      () => (window as unknown as { __WORLDFORGE__: { world: { tick: number } } }).__WORLDFORGE__.world.tick
    );
    if (last >= tick) return last;
    await page.waitForTimeout(16);
  }
  return last;
}

type ScheduledEvent =
  | { at: number; type: "down" | "up"; key: string }
  | { at: number; type: "pointer-lock" }
  | { at: number; type: "pointer-look"; dx: number; dy: number }
  | { at: number; type: "pointer-click" };

type TickScheduledEvent =
  | { atTick: number; type: "down" | "up"; key: string }
  | { atTick: number; type: "pointer-lock" }
  | { atTick: number; type: "pointer-look"; dx: number; dy: number }
  | { atTick: number; type: "pointer-click" }
  | { atTick: number; type: "pointer-screen-click"; u: number; v: number };

async function dispatchEvent(
  page: import("playwright").Page,
  ev: {
    type: "down" | "up" | "pointer-lock" | "pointer-look" | "pointer-click" | "pointer-screen-click";
    key?: string;
    dx?: number;
    dy?: number;
    u?: number;
    v?: number;
  }
): Promise<void> {
  switch (ev.type) {
    case "down":
      await page.keyboard.down(ev.key!);
      break;
    case "up":
      await page.keyboard.up(ev.key!);
      break;
    case "pointer-lock":
      await page.evaluate(
        () => (window as unknown as { __WORLDFORGE__: { pointer?: { lock(): void } } }).__WORLDFORGE__.pointer?.lock()
      );
      break;
    case "pointer-look":
      await page.evaluate(
        ([dx, dy]) =>
          (window as unknown as { __WORLDFORGE__: { pointer?: { look(dx: number, dy: number): void } } }).__WORLDFORGE__.pointer?.look(
            dx as number,
            dy as number
          ),
        [ev.dx, ev.dy]
      );
      break;
    case "pointer-click":
      await page.evaluate(
        () => (window as unknown as { __WORLDFORGE__: { pointer?: { click(): void } } }).__WORLDFORGE__.pointer?.click()
      );
      break;
    case "pointer-screen-click":
      await page.evaluate(
        ([u, v]) =>
          (
            window as unknown as { __WORLDFORGE__: { pointer?: { screenClick?(u: number, v: number): void } } }
          ).__WORLDFORGE__.pointer?.screenClick?.(u as number, v as number),
        [ev.u, ev.v]
      );
      break;
  }
}

async function runInputScript(
  page: import("playwright").Page,
  input: readonly InputStep[],
  deadline: number,
  releaseBarrier?: () => Promise<void>
): Promise<void> {
  if (input.length === 0) {
    if (releaseBarrier) await releaseBarrier();
    return;
  }
  const start = Date.now();
  const msEvents: ScheduledEvent[] = [];
  const tickEvents: TickScheduledEvent[] = [];
  for (const step of input) {
    if ("pointer" in step) {
      if ("atMs" in step) {
        if (step.pointer === "lock") msEvents.push({ at: step.atMs, type: "pointer-lock" });
        else if (step.pointer === "look") msEvents.push({ at: step.atMs, type: "pointer-look", dx: step.dx, dy: step.dy });
        else if (step.pointer === "click") msEvents.push({ at: step.atMs, type: "pointer-click" });
        // screenClick is rejected before this function is ever called.
      } else if ("atTick" in step) {
        if (step.pointer === "lock") tickEvents.push({ atTick: step.atTick, type: "pointer-lock" });
        else if (step.pointer === "look") tickEvents.push({ atTick: step.atTick, type: "pointer-look", dx: step.dx, dy: step.dy });
        else if (step.pointer === "click") tickEvents.push({ atTick: step.atTick, type: "pointer-click" });
        else if (step.pointer === "screenClick")
          tickEvents.push({ atTick: step.atTick, type: "pointer-screen-click", u: step.u, v: step.v });
      }
    } else if ("downMs" in step) {
      msEvents.push({ at: step.downMs, type: "down", key: step.key });
      msEvents.push({ at: step.upMs, type: "up", key: step.key });
    } else {
      // Tick-gated keyboard step: down is dispatched once the polled tick
      // reaches downAtTick, up once it reaches upAtTick. Pushed in this
      // order so the tick-event queue (sequential, declaration order)
      // always processes down before up for a given step.
      tickEvents.push({ atTick: step.downAtTick, type: "down", key: step.key });
      tickEvents.push({ atTick: step.upAtTick, type: "up", key: step.key });
    }
  }

  // Tick-0 events are dispatched synchronously, in declaration order,
  // BEFORE the start barrier is released. This is the fix for the race
  // the round-2 barrier still had: releasing first and then relying on
  // pollUntilTick(0) + dispatch to "catch" tick 0 does not work, because
  // pollUntilTick(0) resolves the instant it's called (0 >= 0 is already
  // true) regardless of whether the sim has since taken a step — once
  // released, the sim is free-running, and a slow page.evaluate round-trip
  // (observed on Firefox, not Chromium) can let the sim's first real step
  // land before the tick-0 dispatch does, silently starting the hold on
  // tick 2 instead of tick 1. A keydown / pointer-lock / look / click is a
  // state change, not a tick-bound event — applying it while the sim is
  // still genuinely paused at tick 0 is both safe and exactly what
  // "downAtTick: 0" / "atTick: 0" mean: the very first tick the sim takes
  // already observes it.
  const tickZero = tickEvents.filter((ev) => ev.atTick === 0);
  const tickRest = tickEvents.filter((ev) => ev.atTick !== 0);
  for (const ev of tickZero) {
    if (Date.now() >= deadline) break;
    await dispatchEvent(page, ev);
  }

  if (releaseBarrier) await releaseBarrier();

  async function runMsEvents(): Promise<void> {
    msEvents.sort((a, b) => a.at - b.at);
    for (const ev of msEvents) {
      const wait = start + ev.at - Date.now();
      if (wait > 0) await page.waitForTimeout(Math.min(wait, Math.max(0, deadline - Date.now())));
      if (Date.now() >= deadline) break;
      await dispatchEvent(page, ev);
    }
  }

  // Remaining tick-gated events run in declaration order (not sorted — a
  // scenario may legitimately wait for the same tick twice, e.g. a look
  // immediately following a key-up gated on the same tick), each waiting
  // via the same pollUntilTick approach the harness already uses for
  // screenshot capture.
  async function runTickEvents(): Promise<void> {
    if (tickRest.length === 0) return;
    // Install the whole queue in-page and let the app's own tick pump drain
    // it via hook.notifyTick, so each step fires synchronously ON its
    // declared tick. The previous approach — poll world.tick from out of
    // process, then dispatch over a round trip — is bounded-late: a key-up
    // gated on tick N could land on N+1, which silently changed the move
    // count between runs. docs/reviews/phase-H0.md round 3 recorded that as
    // debt with exactly this trigger, and it fired in save-restore.
    await page.evaluate((events) => {
      const w = window as unknown as {
        __WORLDFORGE_TICK_QUEUE__?: { atTick: number; run(): void; done?: boolean; error?: string }[];
        __WORLDFORGE__: { pointer?: Record<string, (...a: number[]) => void> };
      };
      const queue: { atTick: number; run(): void; done?: boolean; error?: string }[] = [];
      for (const ev of events) {
        queue.push({
          atTick: ev.atTick,
          run(): void {
            const p = w.__WORLDFORGE__.pointer;
            if (ev.type === "down" || ev.type === "up") {
              const type = ev.type === "down" ? "keydown" : "keyup";
              window.dispatchEvent(new KeyboardEvent(type, { code: ev.key ?? "", bubbles: true }));
            } else if (ev.type === "pointer-lock") p?.lock?.();
            else if (ev.type === "pointer-look") p?.look?.(ev.dx ?? 0, ev.dy ?? 0);
            else if (ev.type === "pointer-click") p?.click?.();
            else if (ev.type === "pointer-screen-click") p?.screenClick?.(ev.u ?? 0, ev.v ?? 0);
          },
        });
      }
      w.__WORLDFORGE_TICK_QUEUE__ = queue;
    }, tickRest as unknown as { atTick: number; type: string; key?: string; dx?: number; dy?: number; u?: number; v?: number }[]);

    // Wait for the queue to drain (or the deadline), then surface any error
    // a step threw in-page rather than letting it vanish.
    const lastTick = Math.max(...tickRest.map((ev) => ev.atTick));
    await pollUntilTick(page, lastTick, deadline);
    const errors = await page.evaluate(() => {
      const w = window as unknown as { __WORLDFORGE_TICK_QUEUE__?: { done?: boolean; error?: string }[] };
      const q = w.__WORLDFORGE_TICK_QUEUE__ ?? [];
      return { pending: q.filter((e) => !e.done).length, errors: q.map((e) => e.error).filter(Boolean) };
    });
    if (errors.errors.length > 0) {
      throw new BrowserInfraError(`Tick-gated input step threw in-page: ${errors.errors.join("; ")}`);
    }
  }

  await Promise.all([runMsEvents(), runTickEvents()]);
}

async function runProbe(
  page: import("playwright").Page,
  spec: ProbeSpec,
  tickRateHz: number,
  deadline: number,
  screenshots: readonly { requestedTick: number; actualTick: number; path: string }[]
): Promise<Record<string, number>> {
  if (spec.probe === "screen-readability") {
    // Reuse the already-captured screenshot (the harness's existing
    // screenshotAtTicks capture path) rather than taking a second one — the
    // most recently requested one is "the declared tick" per
    // docs/PHASE-H1.md Scope D.
    const shot = screenshots[screenshots.length - 1];
    if (!shot) {
      throw new BrowserInfraError(
        `The "screen-readability" probe requires at least one screenshotAtTicks capture; scenario declared none.`
      );
    }
    const screenRect = await page.evaluate(
      () =>
        (
          window as unknown as { __WORLDFORGE__: { screenRect?(): { x: number; y: number; w: number; h: number; texelScale: number } | undefined } }
        ).__WORLDFORGE__.screenRect?.()
    );
    if (!screenRect) {
      throw new BrowserInfraError(
        `The "screen-readability" probe's screenRect() returned undefined at tick ${shot.actualTick} — no screen is ` +
          `focused. The scenario must focus a screen (interact + screenClick) before the probe's screenshot tick.`
      );
    }
    const image = decodePng(readFileSync(shot.path));
    const result = analyzeReadability(image, screenRect, CALIB_RECT);
    return { texelScale: result.texelScale, calibContrast: result.calibContrast, calibPitchErr: result.calibPitchErr };
  }

  if (spec.probe === "fps") {
    const sampleMs = Math.min(spec.sampleMs ?? 1000, Math.max(0, deadline - Date.now()));
    const samples = await page.evaluate(async (ms) => {
      const stamps: number[] = [];
      await new Promise<void>((resolvePromise) => {
        const start = performance.now();
        function frame(t: number) {
          stamps.push(t);
          if (t - start < ms) requestAnimationFrame(frame);
          else resolvePromise();
        }
        requestAnimationFrame(frame);
      });
      return stamps;
    }, sampleMs);
    const deltas: number[] = [];
    for (let i = 1; i < samples.length; i++) deltas.push(1000 / (samples[i]! - samples[i - 1]!));
    if (deltas.length === 0) return { avg: 0, p5: 0, min: 0 };
    const sorted = [...deltas].sort((a, b) => a - b);
    const avg = deltas.reduce((s, v) => s + v, 0) / deltas.length;
    const p5 = sorted[Math.max(0, Math.floor(0.05 * sorted.length))]!;
    return { avg, p5, min: sorted[0]! };
  }

  if (spec.probe === "sim-tick-ms") {
    const minSamples = spec.minSamples ?? 1;
    const deadlineRemaining = Math.max(0, deadline - Date.now());
    const timings = await page.evaluate(
      async ([needed, waitBudgetMs]) => {
        const hook = (window as unknown as { __WORLDFORGE__: { tickTimings?: () => readonly number[] } }).__WORLDFORGE__;
        const start = performance.now();
        let samples = hook.tickTimings?.() ?? [];
        while (samples.length < (needed as number) && performance.now() - start < (waitBudgetMs as number)) {
          await new Promise((r) => setTimeout(r, 16));
          samples = hook.tickTimings?.() ?? [];
        }
        return samples;
      },
      [minSamples, deadlineRemaining]
    );
    if (timings.length === 0) return { avgMs: 0, p95Ms: 0, maxMs: 0 };
    const sorted = [...timings].sort((a, b) => a - b);
    const avgMs = timings.reduce((s, v) => s + v, 0) / timings.length;
    const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]!;
    const maxMs = sorted[sorted.length - 1]!;
    return { avgMs, p95Ms, maxMs };
  }

  // input-latency
  const samples = spec.samples ?? 5;
  const latenciesMs: number[] = [];
  for (let i = 0; i < samples && Date.now() < deadline; i++) {
    const before = await page.evaluate(readFirstComponentValue, spec.component);
    const t0 = Date.now();
    await page.keyboard.down(spec.key);
    await page.waitForFunction(
      ([component, prevJson]) => {
        const w = (window as unknown as { __WORLDFORGE__: { world: { entities(): Iterable<number>; getComponent(e: number, c: string): unknown } } }).__WORLDFORGE__.world;
        for (const e of w.entities()) {
          const v = w.getComponent(e, component as string);
          if (v !== undefined && JSON.stringify(v) !== prevJson) return true;
        }
        return false;
      },
      [spec.component, JSON.stringify(before)],
      { timeout: Math.max(100, deadline - Date.now()) }
    ).catch(() => undefined);
    const elapsed = Date.now() - t0;
    await page.keyboard.up(spec.key);
    latenciesMs.push(elapsed);
    await page.waitForTimeout(50);
  }
  const avgMs = latenciesMs.reduce((s, v) => s + v, 0) / Math.max(1, latenciesMs.length);
  const maxMs = latenciesMs.reduce((m, v) => Math.max(m, v), 0);
  return { avgMs, maxMs, avgTicks: (avgMs * tickRateHz) / 1000 };
}

function readFirstComponentValue(component: string): unknown {
  const w = (window as unknown as { __WORLDFORGE__: { world: { entities(): Iterable<number>; getComponent(e: number, c: string): unknown } } })
    .__WORLDFORGE__.world;
  for (const e of w.entities()) {
    const v = w.getComponent(e, component);
    if (v !== undefined) return v;
  }
  return undefined;
}

function lookupProbeValue(probes: Record<string, Record<string, number>>, key: string): number | undefined {
  // Keys look like "fps.avg", "inputLatency.avgMs", "simTickMs.avgMs", or
  // "screenReadability.texelScale" — map to our probe result names.
  const [probeKey, field] = key.split(".", 2);
  const probeName =
    probeKey === "inputLatency"
      ? "input-latency"
      : probeKey === "simTickMs"
        ? "sim-tick-ms"
        : probeKey === "screenReadability"
          ? "screen-readability"
          : probeKey;
  return probeName && field ? probes[probeName]?.[field] : undefined;
}

async function resolveAppUrl(app: string, repoRoot: string): Promise<{ url: string; cleanup: () => void }> {
  if (/^https?:\/\//.test(app)) {
    return { url: app, cleanup: () => undefined };
  }

  const appDir = resolveWorkspaceDir(app, repoRoot);
  if (!appDir) {
    throw new BrowserInfraError(`Could not resolve workspace "${app}" to a directory under packages/ or apps/.`);
  }

  // shell:true is required for npm's .cmd shim on Windows (spawnSync fails
  // with EINVAL otherwise); `app` is always a workspace name from a
  // scenario module in this repo, never external/untrusted input.
  const build = spawnSync("npm", ["run", "build", "--workspace", app], {
    cwd: repoRoot,
    stdio: "pipe",
    shell: true,
  });
  if (build.status !== 0) {
    throw new BrowserInfraError(`Building "${app}" failed:\n${build.stderr?.toString() ?? build.stdout?.toString() ?? ""}`);
  }

  const { url, server } = await startStaticServer(join(appDir, "dist"));
  return { url, cleanup: () => server.close() };
}

function resolveWorkspaceDir(app: string, repoRoot: string): string | undefined {
  for (const group of ["apps", "packages"]) {
    const groupDir = resolve(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = join(groupDir, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
        if (pkg.name === app) return join(groupDir, entry.name);
      } catch {
        // ignore unreadable package.json
      }
    }
  }
  return undefined;
}

/**
 * Serve a built SPA's static dist/ directory on an OS-assigned free port.
 * Avoids shelling out to `vite preview` (subprocess stdout-readiness
 * detection proved flaky cross-platform) — the harness only needs to serve
 * already-built static files, which a minimal server does directly.
 */
async function startStaticServer(distDir: string): Promise<{ url: string; server: Server }> {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new BrowserInfraError(`No built app found at ${distDir} (expected index.html after build).`);
  }
  const server = createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0]!;
    const safePath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = resolve(join(distDir, safePath));
    if (!filePath.startsWith(resolve(distDir)) || !existsSync(filePath)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const type = STATIC_MIME_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(readFileSync(filePath));
  });
  const port = await new Promise<number>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolvePromise(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  return { url: `http://127.0.0.1:${port}/`, server };
}
