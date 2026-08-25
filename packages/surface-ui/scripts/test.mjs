// Unit tests for @claude-engine/surface-ui, run against the built dist/
// (npm run test -w @claude-engine/surface-ui builds first). Hand-rolled
// assert-and-exit script, matching packages/space/scripts/test.mjs style.
import { SCREEN_H, SCREEN_W, hitRect, createShell, CALIB_RECT } from "../dist/index.js";
import { paintScreen, createScreenSurface, FONT_GLYPHS } from "../dist/host/index.js";
import { generateFontSource } from "./gen-font.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- minimal canvas 2D shim -------------------------------------------------
// Node has no OffscreenCanvas/HTMLCanvasElement; createScreenSurface() and
// paintScreen() are exercised here against a tiny in-memory RGBA-buffer
// context implementing exactly the 2D API surface painter.ts uses
// (fillRect/strokeRect/clearRect/getImageData + fillStyle/strokeStyle/
// lineWidth). This is a real pixel-backed shim, not a structural stand-in —
// paintScreen's determinism test below does a genuine pixel-buffer diff.
function parseColor(css) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(css);
  if (!m) return [0, 0, 0, 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

class FakeCtx2D {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    this.fillStyle = "#000000";
    this.strokeStyle = "#000000";
    this.lineWidth = 1;
  }
  _setPixel(x, y, rgba) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.data[i] = rgba[0];
    this.data[i + 1] = rgba[1];
    this.data[i + 2] = rgba[2];
    this.data[i + 3] = rgba[3];
  }
  fillRect(x, y, w, h) {
    const rgba = parseColor(this.fillStyle);
    for (let yy = Math.floor(y); yy < Math.floor(y) + Math.ceil(h); yy++) {
      for (let xx = Math.floor(x); xx < Math.floor(x) + Math.ceil(w); xx++) {
        this._setPixel(xx, yy, rgba);
      }
    }
  }
  clearRect(x, y, w, h) {
    for (let yy = Math.floor(y); yy < Math.floor(y) + Math.ceil(h); yy++) {
      for (let xx = Math.floor(x); xx < Math.floor(x) + Math.ceil(w); xx++) {
        this._setPixel(xx, yy, [0, 0, 0, 0]);
      }
    }
  }
  strokeRect(x, y, w, h) {
    const rgba = parseColor(this.strokeStyle);
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + w);
    const y1 = Math.round(y + h);
    for (let xx = x0; xx <= x1; xx++) {
      this._setPixel(xx, y0, rgba);
      this._setPixel(xx, y1, rgba);
    }
    for (let yy = y0; yy <= y1; yy++) {
      this._setPixel(x0, yy, rgba);
      this._setPixel(x1, yy, rgba);
    }
  }
  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const srcI = ((y + yy) * this.width + (x + xx)) * 4;
        const dstI = (yy * w + xx) * 4;
        out[dstI] = this.data[srcI];
        out[dstI + 1] = this.data[srcI + 1];
        out[dstI + 2] = this.data[srcI + 2];
        out[dstI + 3] = this.data[srcI + 3];
      }
    }
    return { data: out };
  }
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._ctx = new FakeCtx2D(width, height);
  }
  getContext(kind) {
    return kind === "2d" ? this._ctx : null;
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas;

let failures = 0;

function check(description, pass) {
  if (pass) {
    console.log(`PASS: ${description}`);
  } else {
    console.log(`FAIL: ${description}`);
    failures++;
  }
}

// --- font atlas regeneration is byte-identical to the committed file ------
{
  const here = dirname(fileURLToPath(import.meta.url));
  const committedPath = join(here, "..", "src", "host", "font.ts");
  const committed = readFileSync(committedPath, "utf8");
  const regenerated = generateFontSource();
  check("font.ts: regeneration is byte-identical to committed file", committed === regenerated);
  check("font.ts: has 96 glyphs (0x20..0x7F)", FONT_GLYPHS.length === 96);
  check("font.ts: each glyph is 8 rows", FONT_GLYPHS.every((g) => g.length === 8));
}

// --- hitRect ----------------------------------------------------------------
{
  const rects = {
    a: { x: 0, y: 0, w: 10, h: 10 },
    b: { x: 20, y: 20, w: 10, h: 10 },
    overlapFirst: { x: 5, y: 5, w: 20, h: 20 },
    overlapSecond: { x: 10, y: 10, w: 10, h: 10 },
  };
  check("hitRect: point inside 'a' returns 'a'", hitRect(rects, 5, 5) === "a");
  check("hitRect: point inside 'b' returns 'b'", hitRect(rects, 25, 25) === "b");
  check("hitRect: point outside all rects returns undefined", hitRect(rects, 100, 100) === undefined);
  check("hitRect: right/bottom edges are exclusive", hitRect({ a: { x: 0, y: 0, w: 10, h: 10 } }, 10, 5) === undefined);
  // Overlap precedence: earlier-registered key (insertion order) wins.
  const overlap = { first: { x: 0, y: 0, w: 10, h: 10 }, second: { x: 5, y: 5, w: 10, h: 10 } };
  check("hitRect: overlapping rects resolve to the earlier-registered key", hitRect(overlap, 7, 7) === "first");
}

// --- the alignment property: layout()'s rects hit-test back to themselves --
{
  const SAMPLE_RECTS = {
    accept: { x: 10, y: 10, w: 40, h: 12 },
    deny: { x: 60, y: 10, w: 40, h: 12 },
    room3: { x: 10, y: 40, w: 20, h: 20 },
  };
  const sampleApp = {
    id: "sample",
    init: () => ({ clicked: "" }),
    reduce(state, input) {
      if (input.kind === "click") {
        const hit = hitRect(SAMPLE_RECTS, input.px, input.py);
        return { ...state, clicked: hit ?? "" };
      }
      return state;
    },
    layout: () => SAMPLE_RECTS,
    paintSpec: () => [],
  };

  let allCentersHit = true;
  let allOutsideMiss = true;
  for (const [key, rect] of Object.entries(SAMPLE_RECTS)) {
    const cx = rect.x + Math.floor(rect.w / 2);
    const cy = rect.y + Math.floor(rect.h / 2);
    const centerHit = hitRect(sampleApp.layout(), cx, cy);
    if (centerHit !== key) allCentersHit = false;

    // A point just outside each rect (one pixel past the right edge, same
    // row as the center) must not hit that rect.
    const outsideX = rect.x + rect.w; // exclusive edge, per hitRect's contract
    const outsideHit = hitRect(sampleApp.layout(), outsideX, cy);
    if (outsideHit === key) allOutsideMiss = false;
  }
  check("alignment property: every layout() rect's center hit-tests back to its own key", allCentersHit);
  check("alignment property: a point just outside each rect does not hit it", allOutsideMiss);

  // Exercise via reduce() too, proving reduce's hit-testing agrees with layout().
  const afterClick = sampleApp.reduce(sampleApp.init(), { kind: "click", px: 15, py: 12 });
  check("alignment property via reduce(): click inside 'accept' routes to 'accept'", afterClick.clicked === "accept");
}

// --- uvToPixel ----------------------------------------------------------------
{
  const surface = createScreenSurface();
  const c00 = surface.uvToPixel(0, 1);
  const c11 = surface.uvToPixel(1, 0);
  check("uvToPixel: (u=0,v=1) -> (0,0)", c00.px === 0 && c00.py === 0);
  check(
    "uvToPixel: (u=1,v=0) -> (SCREEN_W-1, SCREEN_H-1)",
    c11.px === SCREEN_W - 1 && c11.py === SCREEN_H - 1
  );
  const negClamped = surface.uvToPixel(-5, 5);
  check("uvToPixel: out-of-range negative u/v clamps to 0", negClamped.px === 0 && negClamped.py === 0);
  const posClamped = surface.uvToPixel(5, -5);
  check(
    "uvToPixel: out-of-range large u/v clamps to max",
    posClamped.px === SCREEN_W - 1 && posClamped.py === SCREEN_H - 1
  );
}

// --- shell --------------------------------------------------------------------
{
  const appA = {
    id: "a",
    init: () => ({ clicks: 0 }),
    reduce(state, input) {
      if (input.kind === "click") return { clicks: state.clicks + 1 };
      return state;
    },
    layout: () => ({ widgetA: { x: 100, y: 100, w: 10, h: 10 } }),
    paintSpec: (state) => [{ kind: "text", x: 0, y: 0, text: `a:${state.clicks}`, color: 8 }],
  };
  const appB = {
    id: "b",
    init: () => ({ opened: true }),
    reduce(state, input) {
      if (input.kind === "key") return { state: { ...state, lastKey: input.code }, effect: { type: "noop", payload: {} } };
      return state;
    },
    layout: () => ({}),
    paintSpec: () => [],
  };

  const shellNoFilter = createShell([appA, appB]);
  const s0 = shellNoFilter.init();
  check("shell: init opens the first registered app", s0.openAppId === "a");

  const view = { tick: 0, data: {} };
  const tbLayout = shellNoFilter.layout(s0, view);
  const btnA = tbLayout["taskbar:a"];
  const btnB = tbLayout["taskbar:b"];
  check("shell: taskbar has a button rect per available app", !!btnA && !!btnB);

  const clickBCenter = { kind: "click", px: btnB.x + 1, py: btnB.y + 1 };
  const afterSwitch = shellNoFilter.reduce(s0, clickBCenter, view);
  const s1 = afterSwitch.state ?? afterSwitch;
  check("shell: clicking a taskbar button switches openAppId", s1.openAppId === "b");

  const paint1 = shellNoFilter.paintSpec(s1, view);
  check("shell: calib node is present on every app's paint output", paint1.some((n) => n.kind === "calib"));

  // reduce() returning a bare S vs {state, effect} — both handled.
  const keyResult = shellNoFilter.reduce(s1, { kind: "key", code: "Enter" }, view);
  check(
    "shell: app reduce() returning {state, effect} is unwrapped and the effect surfaces",
    keyResult.effect && keyResult.effect.type === "noop" && keyResult.state.appStates.b.lastKey === "Enter"
  );
  const clickA = shellNoFilter.reduce(s0, { kind: "click", px: 200, py: 200 }, view); // click inside app a's widget, outside taskbar
  const clickAState = clickA.state ?? clickA;
  check(
    "shell: app reduce() returning a bare state is handled",
    clickAState.appStates.a.clicks === 1 && clickAState.openAppId === "a"
  );

  // available() filter.
  const shellFiltered = createShell([appA, appB], { available: (id) => id === "a" });
  const sf = shellFiltered.init();
  const tbFiltered = shellFiltered.layout(sf, view);
  check(
    "shell: available() filters which apps appear in the taskbar",
    tbFiltered["taskbar:a"] !== undefined && tbFiltered["taskbar:b"] === undefined
  );

  // delegation reaches the focused app's layout/paintSpec.
  const delegatedLayout = shellNoFilter.layout(s0, view);
  check("shell: layout() delegates to the focused app (prefixed keys)", !!delegatedLayout["app:widgetA"]);
  const delegatedPaint = shellNoFilter.paintSpec(s0, view);
  check(
    "shell: paintSpec() delegates to the focused app",
    delegatedPaint.some((n) => n.kind === "text" && n.text === "a:0")
  );

  check("shell: CALIB_RECT is within the 640x480 surface", CALIB_RECT.x + CALIB_RECT.w <= SCREEN_W && CALIB_RECT.y + CALIB_RECT.h <= SCREEN_H);
}

// --- paintScreen determinism ---------------------------------------------------
{
  const nodes = [
    { kind: "panel", rect: { x: 0, y: 0, w: 640, h: 480 }, fill: 0 },
    { kind: "text", x: 10, y: 10, text: "Hello, RESERVA!", color: 8 },
    { kind: "button", rect: { x: 10, y: 30, w: 40, h: 12 }, label: "OK", color: 15, pressed: false },
    { kind: "hline", x: 0, y: 100, w: 640, color: 7 },
    { kind: "table", rect: { x: 10, y: 120, w: 200, h: 40 }, cols: [40, 40], rows: [["a", "b"]], selRow: 0, color: 8 },
    { kind: "calib", rect: CALIB_RECT },
  ];

  // Two independent OffscreenCanvas surfaces, same paint tree.
  const surfaceA = createScreenSurface();
  const surfaceB = createScreenSurface();
  const ctxA = surfaceA.canvas.getContext("2d");
  const ctxB = surfaceB.canvas.getContext("2d");
  paintScreen(ctxA, nodes);
  paintScreen(ctxB, nodes);
  const dataA = ctxA.getImageData(0, 0, SCREEN_W, SCREEN_H).data;
  const dataB = ctxB.getImageData(0, 0, SCREEN_W, SCREEN_H).data;
  let identical = dataA.length === dataB.length;
  if (identical) {
    for (let i = 0; i < dataA.length; i++) {
      if (dataA[i] !== dataB[i]) {
        identical = false;
        break;
      }
    }
  }
  check("paintScreen: painting the same tree twice yields identical pixel data", identical);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log("\nAll surface-ui tests passed.");
}
