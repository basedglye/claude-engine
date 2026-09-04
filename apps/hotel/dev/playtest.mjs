// C2-W1 playtest driver — plays the real, running GRAND FOYER build the way
// a person would: pointer-lock look, WASD-equivalent movement, and clicks,
// all submitted through window.__WORLDFORGE__ (the same command-ingress
// pipe main.ts's own keyboard/mouse handlers use — see
// packages/renderer-three/src/test-hook.ts: "the ONLY sim-affecting
// capability — standard command ingress"). Nothing here writes a component,
// teleports, or reaches a state a player's input could not produce.
//
// Screen-button coordinates are NOT guessed from a screenshot. They are the
// literal Rect constants the terminal apps themselves declare (cited by
// file:line below) — the same numbers hotelShell.layout() would hand back,
// read from source instead of a live dist-game import because this
// worktree is shared with concurrent lanes that repeatedly `rm -rf
// apps/hotel/dist-game` mid-session (hit twice while preparing this
// driver — see the C2-W1 report's "what you did NOT do" section).
//
// C3-W6 RE-RUN (2026-09-03): the COO review (docs/alpha-loop/reviews/C2-W1.md)
// REFUTED this driver's original B3 and found the real defect (F1: the
// shipped game had fraudRatePermille: 0, so no guest was ever fraudulent —
// now fixed upstream, default 200/1000, ~1 in 5). The review also found
// two real bugs in THIS file's original fraud check: it read only the
// FIRST document a guest owned (a guest carries two — "id" and "resSlip")
// and compared same-NAMED keys (the ID's field is "name", the
// reservation's is "guestName" — a name-mismatch fraud could never be
// detected that way). Both are fixed below by mirroring
// scenarios/lib/hotel-owner.mjs's own pattern: collect ALL of the guest's
// documents, then run the sim's OWN pure `evaluateRules` (the same
// function `deskSystem` uses for ground truth and the reference bot uses
// to decide) against them. `reservation.plantedViolations` is never read
// anywhere in this file — evaluateRules is independent ground truth, not a
// peek at the answer key already written into the component.
//
// Also new this run: hold-T fast-forward (8 sim steps/host tick, disabled
// while a screen is focused) landed in main.ts to fix B2's pacing wall —
// used below via holdT() during every real-time wait.
//
// Usage:
//   node apps/hotel/dev/playtest.mjs <url> <outDir> [label]
//
// Prints one JSON line per beat: { beat, id, tick, pass, screenshot, note }.
// Exits 0 if every beat attempted passed, 1 otherwise (the beats it could
// not reach are still reported, with pass:false and a reason).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Pure sim module (no DOM, no host) — same import scenarios/lib/hotel-owner.mjs
// uses for ground truth. dist-game is committed/stable on this branch per
// the coordinator (C3-W6 brief: "DO NOT rebuild dist"). pathToFileURL is
// required on Windows — a bare absolute path ("C:\...") is not a valid
// ESM specifier and throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
const { H1_RULES, evaluateRules, rulesForStars } = await import(
  pathToFileURL(join(__dirname, "..", "dist-game", "sim", "rules.js")).href
);

const URL = process.argv[2];
const OUT = process.argv[3] ?? "artifacts/playtest-shots";
const LABEL = process.argv[4] ?? "run";
if (!URL) {
  console.error("usage: node playtest.mjs <url> <outDir> [label]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// ---- screen-app layout constants, cited from source (SCREEN_W=640, SCREEN_H=480: packages/surface-ui/src/types.ts) ----
const SCREEN_W = 640;
const SCREEN_H = 480;
// taskbar: packages/surface-ui/src/shell.ts (TASKBAR_BTN_W=80, gap=4, first x=4, y=TASKBAR_BTN_Y=SCREEN_H-24+4=460)
const TASKBAR_BTN_Y = 460;
const TASKBAR_BTN_W = 80;
const TASKBAR_BTN_GAP = 4;
// HOTEL_APPS registration order, apps/hotel/src/sim/screen.ts: reserva, audit, ledger, pricer, mailbox, staff
const APP_ORDER = ["reserva", "audit", "ledger", "pricer", "mailbox", "staff"];
function taskbarRect(appId) {
  const idx = APP_ORDER.indexOf(appId);
  if (idx < 0) throw new Error(`unknown app ${appId}`);
  return { x: 4 + idx * (TASKBAR_BTN_W + TASKBAR_BTN_GAP), y: TASKBAR_BTN_Y, w: TASKBAR_BTN_W, h: 16 };
}
// reserva-app.ts (re-run, C3-W6): ACCEPT/DENY moved to y=104 per fix-list
// item F2 (were off-screen at y=440 from the standing desk pose — COO
// review apps/hotel/docs/alpha-loop/reviews/C2-W1.md §1d). Room list still
// starts at y=220.
const RESERVA = {
  accept: { x: 8, y: 104, w: 96, h: 18 },
  deny: { x: 112, y: 104, w: 96, h: 18 },
  roomListX: 8,
  roomListY: 220,
  roomRowH: 18,
  roomRowW: 150,
};
// ledger-app.ts: PREV/NEXT/RENOVATE
const LEDGER = {
  prev: { x: 8, y: 420, w: 96, h: 18 },
  next: { x: 112, y: 420, w: 96, h: 18 },
  renovate: { x: 8, y: 380, w: 200, h: 18 },
};
// staff-app.ts: HIRE/PASS + candidate rows
const STAFF = {
  hire: { x: 8, y: 420, w: 96, h: 18 },
  pass: { x: 112, y: 420, w: 96, h: 18 },
  listX: 8,
  listY: 80,
  rowH: 20,
  rowW: 260,
};

function rectCenterUV(rect) {
  const px = rect.x + rect.w / 2;
  const py = rect.y + rect.h / 2;
  return [px / SCREEN_W, py / SCREEN_H];
}

// ---- bookkeeping ----
const results = [];
let shotN = 0;
function record(beat, id, pass, tick, note, screenshot) {
  const row = { beat, id, tick, pass, screenshot: screenshot ?? null, note };
  results.push(row);
  console.log(JSON.stringify(row));
  return row;
}

/** R1 (COO review, docs/alpha-loop/reviews/C2-W1.md §3): H must skip the
 *  walkthrough only when no terminal screen is focused (main.ts:550,
 *  `!focusedScreen`). Run in its OWN short-lived browser/page — NOT the
 *  main gameplay page below — because `walkthrough.skip()` is one-way
 *  (render/walkthrough.ts): doing this on the main page would permanently
 *  blank every later beat's `data-step` read. */
async function checkHIsolated(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__WORLDFORGE__, null, { timeout: 30000 });
  await page.waitForTimeout(600);
  const visBefore = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-visible"));
  const stepBefore = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-step") ?? null);
  await page.keyboard.down("KeyH");
  await page.keyboard.up("KeyH");
  await page.waitForTimeout(300);
  const visAfter = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-visible"));
  const stepAfter = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-step") ?? null);
  const path = join(OUT, `${LABEL}-00-h-key-isolated.png`);
  await page.screenshot({ path });
  await page.close();
  const pass = visBefore === "1" && visAfter === "0";
  const row = {
    beat: "R1",
    id: "h-skip-isolated",
    tick: null,
    pass,
    screenshot: path,
    note: `fresh page, no screen ever focused; data-visible "${visBefore}" -> "${visAfter}"; data-step "${stepBefore}" -> "${stepAfter}"`,
  };
  results.push(row);
  console.log(JSON.stringify(row));
  return row;
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--ignore-gpu-blocklist"],
  });
  await checkHIsolated(browser);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[console] ${m.text()}`);
  });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  async function shot(name) {
    await page.waitForTimeout(300);
    const path = join(OUT, `${LABEL}-${String(++shotN).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path });
    return path;
  }
  async function tick() {
    return page.evaluate(() => window.__WORLDFORGE__.world.tick);
  }
  async function hintStep() {
    return page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-step") ?? null);
  }
  async function submit(cmd) {
    await page.evaluate((c) => window.__WORLDFORGE__.submit(c), cmd);
  }
  /** DIAGNOSED THIS RE-RUN: submitting a "face" command directly does NOT
   *  turn the real browser player, unlike a headless-harness bot
   *  (scenarios/lib/hotel-owner.mjs runs against a bare Sim via IWorld,
   *  where a submitted face command IS the only yaw authority). In the
   *  live app, player-fps's controller (packages/player-fps/src/index.ts
   *  ~line 316) keeps its OWN internal `camYawMdeg` accumulated purely
   *  from pointer-look deltas, and every frame it compares that against
   *  the sim's actual yaw and RE-SUBMITS a face command to snap the sim
   *  back toward `camYawMdeg` if they drift — so a directly-submitted face
   *  command is overwritten on the very next frame. Confirmed live via
   *  artifacts/diag-guest.mjs: `myYaw.mdeg` stayed exactly 0 across six
   *  submitted face commands with six different target bearings.
   *  Fix: turn with the SAME synthetic pointer a real player's mouse
   *  drives — window.__WORLDFORGE__.pointer.look(dx) — exactly as the
   *  brief's §3.0 always said to. `look(409)` ≈ 90° (ALPHA-LOOK.md,
   *  measured); a small proportional loop below closes the gap to the
   *  real current yaw (read back from the world, not assumed). */
  const LOOK_PX_PER_MDEG = 409 / 90000;
  async function currentYawMdeg() {
    const snap = await snapshot();
    const pe = playerEntity(snap);
    return pe !== undefined ? snap.comps.yaw[pe]?.mdeg : undefined;
  }
  function shortestDeltaMdeg(fromMdeg, toMdeg) {
    let d = ((toMdeg - fromMdeg + 540000) % 360000) - 180000;
    return d;
  }
  async function turnToBearing(targetMdeg, opts = {}) {
    const tolMdeg = opts.tolMdeg ?? 3000; // ~3deg
    const maxIters = opts.maxIters ?? 8;
    for (let i = 0; i < maxIters; i++) {
      const cur = await currentYawMdeg();
      if (cur === undefined) return { ok: false, reason: "no player yaw" };
      const delta = shortestDeltaMdeg(cur, targetMdeg);
      if (Math.abs(delta) <= tolMdeg) return { ok: true, iters: i, finalYaw: cur };
      const dx = Math.round(delta * LOOK_PX_PER_MDEG);
      await look(dx, 0);
      await page.waitForTimeout(80);
    }
    const cur = await currentYawMdeg();
    return { ok: false, reason: `did not converge, yaw=${cur}, target=${targetMdeg}` };
  }
  /** Deprecated alias kept for call-site compatibility this re-run — now
   *  routes through turnToBearing (pointer.look), NOT a submitted "face"
   *  command (see the note above for why that silently did nothing). */
  async function faceCmd(yawMdeg) {
    await turnToBearing(((Math.round(yawMdeg) % 360000) + 360000) % 360000);
  }
  async function moveCmd(forwardMilli, strafeMilli = 0) {
    const t = await tick();
    await submit({ tick: t, actor: "player", type: "move", payload: { forwardMilli, strafeMilli } });
  }
  async function interactCmd(target) {
    const t = await tick();
    await submit({ tick: t, actor: "player", type: "interact", payload: { target } });
  }
  async function screenClickCmd(px, py) {
    const t = await tick();
    await submit({ tick: t, actor: "player", type: "screen.click", payload: { px: Math.round(px), py: Math.round(py) } });
  }
  async function clickRect(rect) {
    await screenClickCmd(rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  async function look(dx, dy = 0) {
    await page.evaluate(([x, y]) => window.__WORLDFORGE__.pointer.look(x, y), [dx, dy]);
  }
  async function walkKey(key, ms) {
    await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    await page.keyboard.up(key);
    await page.waitForTimeout(150);
  }
  /** Hold T (main.ts's fast-forward: 8 sim steps/host tick, disabled while
   *  a screen is focused) for realMs of real wall-clock, then release.
   *  Used for every real-time wait in this re-run — B2's re-measurement is
   *  "wall clock spent holding T", not the sim-tick delta, since that is
   *  exactly what a real player would experience. */
  async function holdT(realMs) {
    await page.keyboard.down("KeyT");
    await page.waitForTimeout(realMs);
    await page.keyboard.up("KeyT");
  }

  // Snapshot every component name the sim uses (apps/hotel/src/sim/components.ts).
  const COMPONENTS = [
    "actorId", "candidate", "collider", "document", "door", "guest", "hotel",
    "interactable", "ledgerEntry", "mail", "mess", "navAgent", "navSchedule",
    "noticeList", "objective", "person", "pos", "prevPos", "prevYaw", "prop",
    "reservation", "roomUnit", "screenApp", "staffWork", "staffed", "terminal", "yaw",
  ];
  async function snapshot() {
    return page.evaluate((names) => {
      const w = window.__WORLDFORGE__.world;
      const entities = [...w.entities()];
      const comps = {};
      for (const name of names) {
        const rows = {};
        for (const e of entities) {
          const v = w.getComponent(e, name);
          if (v !== undefined) rows[e] = v;
        }
        comps[name] = rows;
      }
      return { tick: w.tick, entities, comps };
    }, COMPONENTS);
  }
  function playerEntity(snap) {
    for (const [e, a] of Object.entries(snap.comps.actorId)) if (a.actor === "player") return Number(e);
    return undefined;
  }
  function terminalEntity(snap) {
    const ids = Object.keys(snap.comps.terminal);
    return ids.length ? Number(ids[0]) : undefined;
  }
  function bearingMdeg(fromXZ, toXZ) {
    const dx = toXZ.xMm - fromXZ.xMm;
    const dz = toXZ.zMm - fromXZ.zMm;
    // sim's atan2Mdeg convention: bearing 0 = +z, increases toward +x (see
    // packages/space) — replicate with plain Math.atan2 (this file is
    // tooling, not sim code, so transcendental Math is fine here).
    let deg = (Math.atan2(dx, dz) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return Math.round(deg * 1000);
  }
  function distMm(a, b) {
    const dx = a.xMm - b.xMm;
    const dz = a.zMm - b.zMm;
    return Math.sqrt(dx * dx + dz * dz);
  }

  /** Walk the player toward targetXZ by repeatedly submitting face+move,
   *  polling real position each step (this is the same face/move command
   *  pair a WASD keypress produces — see scenarios/lib/hotel-owner.mjs). */
  /** A closed door within interact range of `pos`, opened by hand the same
   *  way scenarios/lib/hotel-owner.mjs's walkToward does (a player is not
   *  a guest and does not shoulder doors open). Diagnosed this re-run:
   *  messes/props live in bedrooms behind doors, and walkTo previously had
   *  no door-awareness at all, so it silently walked in place against a
   *  closed door for the whole step budget. */
  async function nearestClosedDoor(snap, pos) {
    for (const [eStr, d] of Object.entries(snap.comps.door)) {
      if (d.open) continue;
      const e = Number(eStr);
      const interactable = snap.comps.interactable[e];
      if (!interactable) continue;
      const dist = distMm(pos, { xMm: interactable.xMm, zMm: interactable.zMm });
      if (dist <= interactable.radiusMm) return { entity: e, interactable };
    }
    return undefined;
  }
  async function walkTo(targetXZ, opts = {}) {
    const arriveMm = opts.arriveMm ?? 700;
    const maxSteps = opts.maxSteps ?? 120;
    let last = null;
    let stuckCount = 0;
    let prevD = null;
    for (let i = 0; i < maxSteps; i++) {
      const snap = await snapshot();
      const pe = playerEntity(snap);
      const pos = pe !== undefined ? snap.comps.pos[pe] : undefined;
      if (!pos) return { ok: false, reason: "no player pos" };
      const d = distMm(pos, targetXZ);
      if (d <= arriveMm) return { ok: true, steps: i };
      // A closed door in range: open it first, same act a real player's
      // click-to-open would be, rather than walking into it forever.
      const door = await nearestClosedDoor(snap, pos);
      if (door) {
        await faceCmd(bearingMdeg(pos, { xMm: door.interactable.xMm, zMm: door.interactable.zMm }));
        await page.waitForTimeout(150);
        await interactCmd(door.entity);
        await page.waitForTimeout(250);
        continue;
      }
      const bearing = bearingMdeg(pos, targetXZ);
      await faceCmd(bearing);
      await moveCmd(1000, 0);
      await page.waitForTimeout(120);
      // If distance genuinely stopped shrinking for several steps (stuck
      // against geometry that is not a known door), stop early rather than
      // burning the whole step budget — the caller retries from a fresh
      // approach anyway (takeGuestPapers/approachAndInteract).
      if (prevD !== null && Math.abs(d - prevD) < 30) stuckCount++;
      else stuckCount = 0;
      if (stuckCount >= 15) return { ok: false, reason: `stuck, last dist ${d}mm` };
      prevD = d;
      last = d;
    }
    return { ok: false, reason: `did not arrive, last dist ${last}mm` };
  }

  /** Walk to a guest and interact until their state flips to "presenting"
   *  (interactSystem: state "queued", queueIndex 0, in range+facing arc —
   *  see apps/hotel/src/sim/game.ts's interactSystem comment). Retries
   *  with a FRESH position/bearing each attempt rather than trusting a
   *  single walkTo+face+interact — the arc is only 60000 mdeg (±30°) and
   *  a single stale bearing from before the final approach step can miss
   *  it, especially now the lobby is deeper (5-6m per the C3-W6 brief). */
  async function takeGuestPapers(guestEntity, attempts = 4) {
    for (let i = 0; i < attempts; i++) {
      const s = await snapshot();
      const guest = s.comps.guest[guestEntity];
      if (!guest) return { ok: false, reason: "guest entity vanished" };
      if (guest.state === "presenting") return { ok: true, attempts: i };
      const guestPos = s.comps.pos[guestEntity];
      if (!guestPos) return { ok: false, reason: "no guest pos" };
      await walkTo(guestPos, { arriveMm: 900 });
      const s2 = await snapshot();
      const pe = playerEntity(s2);
      const myPos = pe !== undefined ? s2.comps.pos[pe] : undefined;
      const freshGuestPos = s2.comps.pos[guestEntity] ?? guestPos;
      if (myPos) await faceCmd(bearingMdeg(myPos, freshGuestPos));
      await page.waitForTimeout(200);
      await interactCmd(guestEntity);
      await page.waitForTimeout(350);
    }
    const sFinal = await snapshot();
    return { ok: sFinal.comps.guest[guestEntity]?.state === "presenting", attempts };
  }

  /** Generic version of the same retry-with-fresh-facing pattern for a
   *  static interactable (mess, prop): walk to `posMm`, turn to face it
   *  (turnToBearing / pointer.look, not a submitted face command — see the
   *  note above faceCmd), interact, and check `stillPresent(snap)` after
   *  each attempt. */
  async function approachAndInteract(entity, posMm, stillPresent, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      await walkTo(posMm, { arriveMm: 900 });
      const s2 = await snapshot();
      const pe = playerEntity(s2);
      const myPos = pe !== undefined ? s2.comps.pos[pe] : undefined;
      if (myPos) await faceCmd(bearingMdeg(myPos, posMm));
      await page.waitForTimeout(200);
      await interactCmd(entity);
      await page.waitForTimeout(350);
      const sCheck = await snapshot();
      if (!stillPresent(sCheck)) return { ok: true, attempts: i };
    }
    return { ok: false, attempts };
  }

  console.log(`# playtest.mjs — url=${URL} label=${LABEL}`);
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__WORLDFORGE__, null, { timeout: 30000 });
  const hasPointer = await page.evaluate(() => !!window.__WORLDFORGE__.pointer);
  const hasScreenClick = await page.evaluate(() => !!window.__WORLDFORGE__.pointer?.screenClick);

  // ---- Beat 1: entry ----
  {
    const s1 = await shot("entry");
    const t1 = await tick();
    const entryVisible = await page.evaluate(() => {
      const el = document.querySelector(".hud-entry");
      return !!el && getComputedStyle(el).display !== "none";
    });
    const ctaText = await page.evaluate(() => document.querySelector(".hud-cta")?.textContent ?? "");
    const controlsText = await page.evaluate(() => document.querySelector(".hud-controls")?.textContent ?? "");
    record(1, "enter", entryVisible && ctaText.length > 0, t1, `entry overlay visible; cta="${ctaText}"; controls="${controlsText}"; mentions T=${controlsText.includes("T")}`, s1);

    // Click the canvas to dismiss entry + engage pointer lock, per the entry CTA.
    await page.mouse.click(640, 360);
    await page.waitForTimeout(500);
    if (hasPointer) await page.evaluate(() => window.__WORLDFORGE__.pointer.lock());
    await page.waitForTimeout(300);
    await shot("after-click-canvas");
  }

  // NOTE: R1 (H in isolation, before any screen focus) is run in a
  // SEPARATE throwaway page/session, not here — walkthrough.skip() is
  // one-way (render/walkthrough.ts), so doing it on the main page would
  // permanently blank every later beat's data-step read. See
  // checkHIsolated() below, run once before this main() body starts.

  // ---- Beat 2: walk to the desk ----
  {
    const stepBefore = await hintStep();
    const snap = await snapshot();
    const te = terminalEntity(snap);
    const deskPos = te !== undefined ? snap.comps.pos[te] : undefined;
    let pass = false, note;
    if (!deskPos) {
      note = "no terminal/desk entity found in world snapshot";
    } else {
      const res = await walkTo(deskPos, { arriveMm: 900 });
      const stepAfter = await hintStep();
      pass = res.ok && (stepAfter === "take-papers" || stepAfter !== stepBefore);
      note = `hint before="${stepBefore}" after="${stepAfter}"; walk ${JSON.stringify(res)}`;
    }
    const t2 = await tick();
    const s2 = await shot("near-desk");
    record(2, "walk-to-desk", pass, t2, note, s2);
  }

  // ================================================================
  // C3-W7: single continuous service loop, played the way a competent
  // owner actually plays -- never blind-waiting while a guest or a mess
  // sits there. Priority order, every cycle, exactly as specified:
  //   1. a guest is presenting/queued and reachable -> serve it (read
  //      BOTH documents, evaluateRules, ACCEPT/DENY -- never
  //      plantedViolations, mirroring scenarios/lib/hotel-owner.mjs).
  //   2. else a mess/broken prop exists and no guest waiting -> clean/
  //      repair it.
  //   3. else cash covers RENOVATE's cost -> open LEDGER, press it (the
  //      button itself re-validates the star gate; a press when stars
  //      are short is a harmless no-op, same as a real click would be).
  //   4. else hold T for a short burst (<=200 ticks) and re-check.
  // Also hires a clerk the moment STAFF shows a candidate, at any point.
  // ================================================================
  const dayLog = [];
  let lastLoggedDay = null;
  let fraudCaughtCount = 0;
  let legitCheckinCount = 0;
  const fraudCases = [];
  let tier1Shot = null;
  let tier2Shot = null;
  let endCardShot = null;
  let afterEndCardShot = null;
  let sawEndCard = false;
  let endCardAtDay = null;
  let hiredClerk = false;
  let blockedFinding = null; // set if the game itself refuses tier 2 for a competent player

  async function recordDay(hotel, tickNow) {
    if (hotel && hotel.day !== lastLoggedDay) {
      lastLoggedDay = hotel.day;
      const row = { day: hotel.day, cash: hotel.cash, stars: hotel.stars, tier: hotel.tier, tick: tickNow };
      dayLog.push(row);
      console.log("DAY " + JSON.stringify(row));
    }
  }

  async function serveDeskCycle(snap) {
    const presenting = Object.entries(snap.comps.guest).find(([, g]) => g.state === "presenting");
    const queueHead = Object.entries(snap.comps.guest).find(([, g]) => g.state === "queued" && g.queueIndex === 0);
    if (!presenting && !queueHead) return;

    if (!presenting && queueHead) {
      await takeGuestPapers(Number(queueHead[0]), 3);
      return;
    }

    const te = terminalEntity(snap);
    if (te !== undefined) {
      const focusedBy = snap.comps.terminal[te]?.focusedBy;
      if (!focusedBy) {
        const termPos = snap.comps.pos[te];
        if (termPos) {
          await walkTo(termPos, { arriveMm: 1000 });
          const s2 = await snapshot();
          const pe2 = playerEntity(s2);
          const myPos2 = pe2 !== undefined ? s2.comps.pos[pe2] : undefined;
          if (myPos2) await faceCmd(bearingMdeg(myPos2, termPos));
          await page.waitForTimeout(150);
          await interactCmd(te);
          await page.waitForTimeout(200);
        }
      }
    }
    const shellState = await page.evaluate(() => {
      const w = window.__WORLDFORGE__.world;
      for (const e of w.entities()) {
        const app = w.getComponent(e, "screenApp");
        if (app) return app.state;
      }
      return undefined;
    });
    if (shellState?.openAppId !== "reserva") {
      await clickRect(taskbarRect("reserva"));
      await page.waitForTimeout(150);
    }

    const snap2 = await snapshot();
    const presenting2 = Object.entries(snap2.comps.guest).find(([, g]) => g.state === "presenting");
    if (!presenting2) return;
    const guestEntity = Number(presenting2[0]);
    const resEntry = Object.entries(snap2.comps.reservation).find(([, r]) => r.guestEntity === guestEntity && !r.decided);
    if (!resEntry) return;
    const res = resEntry[1];
    const docs = Object.values(snap2.comps.document)
      .filter((d) => d.ownerEntity === guestEntity)
      .map((d) => ({ docType: d.docType, fields: d.fields }));
    const lists = {};
    for (const nl of Object.values(snap2.comps.noticeList)) lists[nl.listId] = nl.values;
    const hotelState = Object.values(snap2.comps.hotel)[0];
    const violations = evaluateRules(
      rulesForStars(H1_RULES, hotelState?.stars ?? 1),
      docs,
      res.fields,
      { day: hotelState?.day ?? 0, lists }
    );
    const brokenRooms = new Set(Object.values(snap2.comps.prop).filter((p) => p.broken).map((p) => p.roomEntity));
    const rooms = Object.entries(snap2.comps.roomUnit)
      .filter(([, r]) => r.occupantEntity === 0 && r.messCount === 0)
      .filter(([e]) => !brokenRooms.has(Number(e)))
      .sort((a, b) => a[1].roomId - b[1].roomId);

    if (violations.length > 0) {
      fraudCaughtCount++;
      const fieldDiffs = [];
      for (const rule of H1_RULES) {
        if (!violations.includes(rule.failFlag)) continue;
        if (rule.check.kind === "fieldMatch") {
          const doc = docs.find((d) => d.docType === rule.check.docType);
          fieldDiffs.push(
            `${rule.failFlag}: ${rule.check.docType}.${rule.check.docField}="${doc?.fields?.[rule.check.docField]}" vs reservation.${rule.check.resField}="${res.fields?.[rule.check.resField]}"`
          );
        } else {
          fieldDiffs.push(`${rule.failFlag} (${rule.check.kind})`);
        }
      }
      fraudCases.push({ tick: snap2.tick, day: hotelState?.day, violations, fieldDiffs });
      await clickRect(RESERVA.deny);
    } else if (rooms.length > 0) {
      legitCheckinCount++;
      const y = RESERVA.roomListY;
      await screenClickCmd(RESERVA.roomListX + RESERVA.roomRowW / 2, y + RESERVA.roomRowH / 2);
      await page.waitForTimeout(150);
      await clickRect(RESERVA.accept);
    } else {
      await clickRect(RESERVA.deny);
    }
    await page.waitForTimeout(300);
  }

  const sessionStartWallMs = Date.now();
  const maxCycles = 20000;
  let cycles = 0;
  let stuckSameDayCycles = 0;
  for (; cycles < maxCycles; cycles++) {
    const snap = await snapshot();
    const hotel = Object.values(snap.comps.hotel)[0];
    const tickNow = snap.tick;
    const dayBefore = lastLoggedDay;
    await recordDay(hotel, tickNow);
    if (lastLoggedDay === dayBefore) stuckSameDayCycles++;
    else stuckSameDayCycles = 0;
    if (cycles % 50 === 0) console.log(`CYCLE ${cycles} tick=${tickNow} day=${hotel?.day} cash=${hotel?.cash} stuckSameDayCycles=${stuckSameDayCycles}`);

    if (hotel && hotel.tier >= 1 && !tier1Shot) {
      await faceCmd(0);
      await page.waitForTimeout(200);
      tier1Shot = await shot("tier1-lobby");
    }
    if (hotel && hotel.tier >= 2 && !tier2Shot) {
      await faceCmd(0);
      await page.waitForTimeout(200);
      tier2Shot = await shot("tier2-lobby");
    }

    const endCardVisible = await page.evaluate(() => document.querySelector(".hud-endcard")?.getAttribute("data-visible") === "1");
    if (endCardVisible && !sawEndCard) {
      sawEndCard = true;
      endCardAtDay = hotel?.day ?? lastLoggedDay;
      endCardShot = await shot("endcard");
    }
    if (sawEndCard && hotel && endCardAtDay !== null && hotel.day > endCardAtDay) {
      afterEndCardShot = await shot("after-endcard-playing");
      break;
    }
    if (!sawEndCard && hotel && hotel.day > 14) {
      blockedFinding = {
        reason: "14 in-game days passed with no end card (tier 2 never reached) under continuous competent play",
        hotelStateAtCutoff: hotel,
        tick: tickNow,
      };
      break;
    }
    if (stuckSameDayCycles > 400) {
      blockedFinding = blockedFinding ?? {
        reason: `loop made ${stuckSameDayCycles} cycles with the sim day never advancing`,
        hotelStateAtCutoff: hotel,
        tick: tickNow,
      };
      break;
    }

    const presenting = Object.entries(snap.comps.guest).find(([, g]) => g.state === "presenting");
    const queueHead = Object.entries(snap.comps.guest).find(([, g]) => g.state === "queued" && g.queueIndex === 0);
    if (presenting || queueHead) {
      await serveDeskCycle(snap);
      continue;
    }

    const messEntry = Object.entries(snap.comps.mess)[0];
    const propEntry = Object.entries(snap.comps.prop).find(([, p]) => p.broken);
    if (messEntry) {
      const messEntity = Number(messEntry[0]);
      const interactablePos = snap.comps.interactable?.[messEntity];
      if (interactablePos) {
        await approachAndInteract(
          messEntity,
          { xMm: interactablePos.xMm, zMm: interactablePos.zMm },
          (s2) => s2.comps.mess[messEntity] !== undefined,
          2
        );
      }
      continue;
    }
    if (propEntry) {
      const propEntity = Number(propEntry[0]);
      const interactablePos = snap.comps.interactable?.[propEntity];
      if (interactablePos) {
        await approachAndInteract(
          propEntity,
          { xMm: interactablePos.xMm, zMm: interactablePos.zMm },
          (s2) => s2.comps.prop[propEntity]?.broken !== false,
          2
        );
      }
      continue;
    }

    const candidateEntry = Object.entries(snap.comps.candidate)[0];
    if (candidateEntry && !hiredClerk) {
      await clickRect(taskbarRect("staff"));
      await page.waitForTimeout(150);
      await screenClickCmd(STAFF.listX + STAFF.rowW / 2, STAFF.listY + STAFF.rowH / 2);
      await page.waitForTimeout(150);
      await clickRect(STAFF.hire);
      await page.waitForTimeout(300);
      const s3 = await snapshot();
      if (Object.keys(s3.comps.staffed).length > 0) hiredClerk = true;
      continue;
    }

    if (hotel && hotel.renovateCostMinor > 0 && hotel.cash >= hotel.renovateCostMinor) {
      await clickRect(taskbarRect("ledger"));
      await page.waitForTimeout(150);
      await clickRect(LEDGER.renovate);
      await page.waitForTimeout(400);
      continue;
    }

    await submit({ tick: await tick(), actor: "player", type: "screen.blur", payload: {} });
    await holdT(1200);
  }

  const sessionDurationMs = Date.now() - sessionStartWallMs;
  const finalSnap = await snapshot();
  const finalHotel = Object.values(finalSnap.comps.hotel)[0];
  const fraudMissedCount = Object.values(finalSnap.comps.guest).filter((g) => g.fraudMissed === true).length;

  record(
    "loop",
    "continuous-service-loop",
    !blockedFinding,
    finalSnap.tick,
    `cycles=${cycles}, wallMs=${sessionDurationMs}, finalHotel=${JSON.stringify(finalHotel)}, sawEndCard=${sawEndCard}, endCardAtDay=${endCardAtDay}, fraudCaught=${fraudCaughtCount}, fraudMissed=${fraudMissedCount}, legitCheckins=${legitCheckinCount}, hiredClerk=${hiredClerk}, blockedFinding=${JSON.stringify(blockedFinding)}`,
    tier2Shot ?? tier1Shot ?? null
  );
  console.log("DAY_LOG " + JSON.stringify(dayLog));
  console.log("FRAUD_CASES " + JSON.stringify(fraudCases));
  console.log("SHOTS " + JSON.stringify({ tier1Shot, tier2Shot, endCardShot, afterEndCardShot }));
  if (blockedFinding) console.log("BLOCKED_FINDING " + JSON.stringify(blockedFinding));



  console.log("---SUMMARY---");
  console.log(JSON.stringify({ url: URL, label: LABEL, results, consoleErrors: consoleErrors.slice(0, 50), requestCount: requests.length, requests: requests.slice(0, 20) }, null, 2));

  await browser.close();
  const anyFail = results.some((r) => r.pass === false);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error("[playtest] FATAL", e);
  process.exit(3);
});
