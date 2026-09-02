/**
 * Bundles the built hotel into ONE self-contained .html file -- the whole
 * game, playable from a single document with no server and no external
 * fetches (every asset is synthesized at load, which is what makes this
 * possible at all).
 *
 * Usage: npm run build -w @claude-engine/hotel && node apps/hotel/scripts/build-single-file-demo.mjs <out.html>
 *
 * It also wraps the game in two things the bare bundle does not have:
 *   - a briefing card, so someone handed the link knows what the game is
 *     and which keys do what before they are standing in a lobby;
 *   - an input fallback for EMBEDDED contexts. Pointer lock is unavailable
 *     inside an iframe ("The root document of this element is not valid for
 *     pointer lock"), and the FPS controller gates look and movement on
 *     being locked, so framed the game is unplayable. The wrapper drives the
 *     app's own synthetic-input contract (window.__WORLDFORGE__.pointer) --
 *     the same seam the harness uses -- instead of patching the engine for
 *     one host.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const distDir = "apps/hotel/dist";
const assetDir = join(distDir, "assets");
const jsName = readdirSync(assetDir).find((f) => f.endsWith(".js"));
if (!jsName) throw new Error("no built bundle found");
const bundle = readFileSync(join(assetDir, jsName), "utf8");

// A literal </script> inside any string in the bundle would close our inline
// script tag early. Escaping the slash is inert to JS and safe in HTML.
const safeBundle = bundle.replace(/<\/script/gi, "<\\/script");

const head = `<title>Grand Foyer Front Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --ground: #14181d;
    --panel: rgba(24, 29, 35, 0.94);
    --panel-edge: #2f3945;
    --ink: #dbe2ea;
    --ink-dim: #93a0ad;
    --ink-faint: #64707d;
    --accent: #c8a37c;
    --go: #6fae9c;
    --display: "Chakra Petch", "Segoe UI", system-ui, sans-serif;
    --body: "IBM Plex Sans", system-ui, sans-serif;
    --mono: "IBM Plex Mono", ui-monospace, monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { background: var(--ground); overflow: hidden; font-family: var(--body); color: var(--ink); }
  canvas#app { display: block; width: 100vw; height: 100vh; }

  /* ---- the briefing card, shown until you take the desk ---------------- */
  #briefing {
    position: fixed; inset: 0; z-index: 20;
    display: grid; place-items: center;
    background: radial-gradient(ellipse at 50% 40%, #1c222a 0%, #0f1216 70%);
    padding: 24px;
  }
  #briefing.gone { display: none; }
  .card {
    width: min(660px, 100%);
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 4px;
    padding: 28px 30px 24px;
    box-shadow: 0 24px 70px rgba(0,0,0,0.6);
  }
  .card .eyebrow {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.18em;
    text-transform: uppercase; color: var(--accent); margin-bottom: 10px;
  }
  .card h1 {
    font-family: var(--display); font-weight: 700; font-size: 30px;
    letter-spacing: 0.02em; line-height: 1.1; margin-bottom: 10px;
    text-wrap: balance;
  }
  .card .lede { font-size: 14.5px; line-height: 1.6; color: var(--ink-dim); max-width: 58ch; }
  .keys {
    margin: 20px 0 18px; display: grid; gap: 9px;
    grid-template-columns: max-content 1fr; align-items: baseline;
    font-size: 13.5px; column-gap: 16px;
  }
  .keys dt { font-family: var(--mono); font-size: 11.5px; color: var(--ink); letter-spacing: 0.03em; }
  .keys dd { color: var(--ink-dim); }
  .card .rule { height: 1px; background: var(--panel-edge); margin: 18px 0; }
  .card .fine { font-size: 12.5px; color: var(--ink-faint); line-height: 1.55; }
  button#take {
    margin-top: 20px; width: 100%;
    font-family: var(--display); font-weight: 700; font-size: 14px;
    letter-spacing: 0.09em; text-transform: uppercase;
    padding: 13px; border-radius: 3px; cursor: pointer;
    background: rgba(111,174,156,0.16);
    border: 1px solid var(--go); color: #b7ddd2;
    transition: background 130ms ease;
  }
  button#take:hover { background: rgba(111,174,156,0.28); }
  button#take:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  /* ---- persistent hint strip ------------------------------------------ */
  #hint {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 14px;
    z-index: 10; pointer-events: none;
    font-family: var(--mono); font-size: 11px; letter-spacing: 0.04em;
    color: var(--ink-faint); background: rgba(20,24,29,0.72);
    border: 1px solid var(--panel-edge); border-radius: 2px; padding: 6px 12px;
    white-space: nowrap; opacity: 1; transition: opacity 400ms ease;
  }
  #hint.fade { opacity: 0; }
  #hint kbd { color: var(--ink-dim); background: #262e37; border-radius: 2px; padding: 1px 5px; }
  @media (prefers-reduced-motion: reduce) { #hint { transition: none; } }
  @media (max-width: 620px) { #hint { display: none; } .card h1 { font-size: 24px; } }
</style>`;

const body = `<canvas id="app"></canvas>

<div id="hint">
  <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk &nbsp;&middot;&nbsp; drag to look &nbsp;&middot;&nbsp;
  <kbd>E</kbd> interact &nbsp;&middot;&nbsp; click the screen to use it 
</div>

<div id="briefing">
  <div class="card">
    <div class="eyebrow">Grand Foyer &middot; ground floor</div>
    <h1>You are the night clerk.</h1>
    <p class="lede">
      Guests will start arriving at the front desk. Each one hands you an ID and a
      reservation slip. Your job is to read the papers against the procedures on the
      terminal, pick a vacant room, and accept them &mdash; or turn them away when the
      papers do not agree.
    </p>

    <dl class="keys">
      <dt>W A S D</dt><dd>Walk. The desk is ahead of you and slightly left.</dd>
      <dt>Drag</dt><dd>Look around. Click without dragging to interact.</dd>
      <dt>E</dt><dd>Interact &mdash; take papers from a guest, wipe a mess, use the terminal.</dd>
      <dt>Click</dt><dd>With the terminal focused, click buttons on the screen directly.</dd>
      
    </dl>

    <div class="rule"></div>
    <p class="fine">
      Everything you see is generated from a seed at load: the floor plan, the texture
      atlas, the lighting bake, the music and the guests' names and papers. Nothing here
      is an authored asset. The sim runs at a fixed 20&nbsp;Hz and the whole session is
      reproducible from its seed plus your inputs.
    </p>

    <button id="take" type="button">Take the desk</button>
  </div>
</div>`;

const tail = `<script type="module">
${safeBundle}
</${"script"}>
<script>
(function () {
  var briefing = document.getElementById("briefing");
  var hint = document.getElementById("hint");
  var canvas = document.getElementById("app");

  // POINTER LOCK IS NOT AVAILABLE IN AN EMBEDDED FRAME.
  // The game asks for it on canvas click, and inside the artifact viewer's
  // iframe that rejects with "The root document of this element is not valid
  // for pointer lock" -- an unhandled rejection, and no look or movement,
  // because the controller gates both on being locked.
  //
  // Rather than patch the engine for one host, this drives the app's OWN
  // synthetic-input contract (window.__WORLDFORGE__.pointer), the same seam
  // the harness uses to prove real and synthetic input agree. hook.pointer
  // .lock() tells the controller it is live; drag deltas go through
  // .look(); clicks through .click(). If real pointer lock DOES engage
  // (running this file directly rather than framed), the browser drives
  // look itself and the drag fallback stays out of the way.
  window.addEventListener("unhandledrejection", function (e) {
    if (e.reason && String(e.reason.name) === "WrongDocumentError") e.preventDefault();
  });

  function hook() { return window.__WORLDFORGE__; }

  var dragging = false, lastX = 0, lastY = 0, moved = 0;

  canvas.addEventListener("pointerdown", function (e) {
    if (document.pointerLockElement) return;
    dragging = true; moved = 0;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging || document.pointerLockElement) return;
    var dx = e.clientX - lastX, dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX; lastY = e.clientY;
    var h = hook();
    if (h && h.pointer) h.pointer.look(dx, dy);
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    if (e.pointerId !== undefined && canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    // Deliberately NOT forwarding a synthetic click here. Once
    // pointer.lock() has told the controller it is live, the game's OWN
    // canvas click handler is ungated and fires for real clicks -- adding a
    // synthetic one on top would interact twice per click (pick a document
    // up and put it straight back down).
    void moved;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  document.getElementById("take").addEventListener("click", function () {
    briefing.classList.add("gone");
    var tries = 0;
    (function arm() {
      var h = hook();
      if (h && h.pointer) {
        h.pointer.lock();
        return;
      }
      if (tries++ < 200) setTimeout(arm, 50);
    })();
    setTimeout(function () { hint.classList.add("fade"); }, 14000);
  });
})();
</${"script"}>`;

writeFileSync(process.argv[2], head + "\n\n" + body + "\n\n" + tail);
console.log("wrote", process.argv[2], "bytes", (head + body + tail).length);
