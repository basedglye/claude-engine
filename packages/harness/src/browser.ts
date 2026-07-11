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
import type { Scenario } from "./index.js";

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

export interface BrowserSpec {
  /** Workspace name (e.g. "@claude-engine/demo") — harness builds it and
   *  serves via vite preview — or an http(s):// URL to use as-is. */
  app: string;
  /** Wall-clock keyboard script (KeyboardEvent.code), driven by Playwright. */
  input?: readonly { key: string; downMs: number; upMs: number }[];
  /** Sim ticks (via the test hook) at which to capture screenshots. */
  screenshotAtTicks?: readonly number[];
  probes?: readonly ProbeSpec[];
  /** Abort (exit 2) if the run exceeds this. Default 30_000. */
  timeoutMs?: number;
}

export type ProbeSpec =
  | { probe: "fps"; sampleMs?: number }
  | { probe: "input-latency"; key: string; component: string; samples?: number };

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

export async function runBrowserScenario(
  scenario: Scenario,
  repoRoot: string,
  opts: { screenshotDir?: string } = {}
): Promise<BrowserRunResult> {
  const spec = scenario.browser as BrowserSpec | undefined;
  if (!spec) {
    throw new BrowserInfraError(`Scenario "${scenario.name}" has no browser spec (scenario.browser is required for --browser).`);
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

  // Headless Chromium's default GL backend fails to compile Three.js's
  // shaders on many CI/sandboxed machines (shader VALIDATE_STATUS false ->
  // WebGL context loss -> a blank canvas with no console error to explain
  // it). ANGLE-over-SwiftShader is a reliable software rasterizer fallback.
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(err.message));

    const deadline = Date.now() + timeoutMs;
    await page.goto(url, { timeout: timeoutMs });

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

    const screenshots: { requestedTick: number; actualTick: number; path: string }[] = [];
    const requestedTicks = [...(spec.screenshotAtTicks ?? [])].sort((a, b) => a - b);
    const targetTick = requestedTicks.length > 0 ? requestedTicks[requestedTicks.length - 1]! : undefined;

    // Drive the wall-clock input script in real time.
    const inputDone = runInputScript(page, spec.input ?? [], deadline);

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
      probeResults[p.probe] = await runProbe(page, p, tickRateHz, deadline);
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

async function runInputScript(
  page: import("playwright").Page,
  input: readonly { key: string; downMs: number; upMs: number }[],
  deadline: number
): Promise<void> {
  if (input.length === 0) return;
  const start = Date.now();
  const events: { at: number; type: "down" | "up"; key: string }[] = [];
  for (const step of input) {
    events.push({ at: step.downMs, type: "down", key: step.key });
    events.push({ at: step.upMs, type: "up", key: step.key });
  }
  events.sort((a, b) => a.at - b.at);
  for (const ev of events) {
    const wait = start + ev.at - Date.now();
    if (wait > 0) await page.waitForTimeout(Math.min(wait, Math.max(0, deadline - Date.now())));
    if (Date.now() >= deadline) break;
    if (ev.type === "down") await page.keyboard.down(ev.key);
    else await page.keyboard.up(ev.key);
  }
}

async function runProbe(
  page: import("playwright").Page,
  spec: ProbeSpec,
  tickRateHz: number,
  deadline: number
): Promise<Record<string, number>> {
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
  // Keys look like "fps.avg" or "inputLatency.avgMs" — map to our probe result names.
  const [probeKey, field] = key.split(".", 2);
  const probeName = probeKey === "inputLatency" ? "input-latency" : probeKey;
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
