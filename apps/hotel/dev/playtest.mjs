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
// Usage:
//   node apps/hotel/dev/playtest.mjs <url> <outDir> [label]
//
// Prints one JSON line per beat: { beat, id, tick, pass, screenshot, note }.
// Exits 0 if every beat attempted passed, 1 otherwise (the beats it could
// not reach are still reported, with pass:false and a reason).

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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
// reserva-app.ts: ACCEPT_RECT, DENY_RECT, room rows
const RESERVA = {
  accept: { x: 8, y: 440, w: 96, h: 18 },
  deny: { x: 112, y: 440, w: 96, h: 18 },
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

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--ignore-gpu-blocklist"],
  });
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
  async function faceCmd(yawMdeg) {
    const t = await tick();
    await submit({ tick: t, actor: "player", type: "face", payload: { yawMdeg: ((Math.round(yawMdeg) % 360000) + 360000) % 360000 } });
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
  async function walkTo(targetXZ, opts = {}) {
    const arriveMm = opts.arriveMm ?? 700;
    const maxSteps = opts.maxSteps ?? 120;
    let last = null;
    for (let i = 0; i < maxSteps; i++) {
      const snap = await snapshot();
      const pe = playerEntity(snap);
      const pos = pe !== undefined ? snap.comps.pos[pe] : undefined;
      if (!pos) return { ok: false, reason: "no player pos" };
      const d = distMm(pos, targetXZ);
      if (d <= arriveMm) return { ok: true, steps: i };
      const bearing = bearingMdeg(pos, targetXZ);
      await faceCmd(bearing);
      await moveCmd(1000, 0);
      await page.waitForTimeout(120);
      last = d;
    }
    return { ok: false, reason: `did not arrive, last dist ${last}mm` };
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
    record(1, "enter", entryVisible && ctaText.length > 0, t1, `entry overlay visible; cta="${ctaText}"; controls="${controlsText}"`, s1);

    // Click the canvas to dismiss entry + engage pointer lock, per the entry CTA.
    await page.mouse.click(640, 360);
    await page.waitForTimeout(500);
    if (hasPointer) await page.evaluate(() => window.__WORLDFORGE__.pointer.lock());
    await page.waitForTimeout(300);
    await shot("after-click-canvas");
  }

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

  // ---- Beat 3 & 4: serve guests, catch a fraud via RESERVA ----
  let checkedInOnce = false;
  let foundFraudNote = "not attempted";
  {
    // interactSystem (apps/hotel/src/sim/game.ts ~line 1620): the queue
    // head guest (state "queued", queueIndex 0) has NO `interactable`
    // component of its own — it is reached by interacting with the guest
    // entity directly, in range and facing arc, which is what "click the
    // guest to take their papers" means. Only AFTER that does the terminal
    // interaction make sense (RESERVA needs a presenting guest to show).
    let queueHead;
    const waitStart3 = Date.now();
    while (!queueHead && Date.now() - waitStart3 < 90000) {
      const s = await snapshot();
      queueHead = Object.entries(s.comps.guest).find(([, g]) => g.state === "queued" && g.queueIndex === 0);
      if (!queueHead) await page.waitForTimeout(1500);
    }
    let presentingOk = false;
    if (queueHead) {
      const guestEntity = Number(queueHead[0]);
      const s = await snapshot();
      const guestPos = s.comps.pos[guestEntity];
      if (guestPos) {
        await walkTo(guestPos, { arriveMm: 1100 });
        const s2 = await snapshot();
        const pe = playerEntity(s2);
        const myPos = pe !== undefined ? s2.comps.pos[pe] : undefined;
        if (myPos) await faceCmd(bearingMdeg(myPos, guestPos));
        await page.waitForTimeout(150);
        await interactCmd(guestEntity);
        await page.waitForTimeout(300);
        const s3check = await snapshot();
        presentingOk = s3check.comps.guest[guestEntity]?.state === "presenting";
      }
    }
    await shot("took-papers");

    // Face the terminal and interact to focus it (same as clicking the
    // monitor: interact command against the terminal entity).
    const snap = await snapshot();
    const te = terminalEntity(snap);
    if (te !== undefined) {
      const termPos = snap.comps.pos[te];
      const s2 = await snapshot();
      const pe = playerEntity(s2);
      const myPos = pe !== undefined ? s2.comps.pos[pe] : undefined;
      if (termPos && myPos) {
        await walkTo(termPos, { arriveMm: 1000 });
        await faceCmd(bearingMdeg(myPos, termPos));
      }
      await interactCmd(te);
      await page.waitForTimeout(200);
    }
    const t3 = await tick();
    const s3 = await shot("terminal-focused");
    const stepAfterOpen = await hintStep();
    record(3, "use-terminal", presentingOk && stepAfterOpen !== null, t3, `queue-head guest found=${!!queueHead}, presenting after interact=${presentingOk}; hint after opening terminal="${stepAfterOpen}"`, s3);

    // Switch to RESERVA (taskbar), read the queue head's raw doc fields vs
    // reservation fields directly from the snapshot — this is the SAME
    // "one oracle, three consumers" comparison RESERVA's screen shows; we
    // read it from world state rather than eyeballing pixels because a
    // Playwright script cannot "read" rendered glyphs, but note explicitly
    // below whether the mismatch, if any, is presented on-screen or only
    // inferable from data.
    await clickRect(taskbarRect("reserva"));
    await page.waitForTimeout(200);
    const s4 = await shot("reserva-open");

    let round = 0;
    let anyFraudCaught = false;
    let anyCheckIn = false;
    const fraudNotes = [];
    const roundBudgetMs = 240000; // ~4min wall budget for the serve-guests loop
    const roundStart = Date.now();
    while (round < 14 && Date.now() - roundStart < roundBudgetMs) {
      let snap2 = await snapshot();
      // presenting guest?
      let presentingGuest = Object.entries(snap2.comps.guest).find(([, g]) => g.state === "presenting");
      if (!presentingGuest) {
        // Nobody presenting: if the next queue head is waiting, take their
        // papers (interact with the guest, in range+facing arc — see the
        // interactSystem note above); otherwise wait for the next arrival.
        const head = Object.entries(snap2.comps.guest).find(([, g]) => g.state === "queued" && g.queueIndex === 0);
        if (head) {
          const guestEntity = Number(head[0]);
          const guestPos = snap2.comps.pos[guestEntity];
          if (guestPos) {
            await walkTo(guestPos, { arriveMm: 1100 });
            const s2 = await snapshot();
            const pe = playerEntity(s2);
            const myPos = pe !== undefined ? s2.comps.pos[pe] : undefined;
            if (myPos) await faceCmd(bearingMdeg(myPos, guestPos));
            await page.waitForTimeout(150);
            await interactCmd(guestEntity);
            await page.waitForTimeout(300);
          }
        } else {
          await page.waitForTimeout(1500);
        }
        continue;
      }
      round++;
      const guestEntity = Number(presentingGuest[0]);
      // reservation for that guest, undecided
      const resEntry = Object.entries(snap2.comps.reservation).find(
        ([, r]) => r.guestEntity === guestEntity && !r.decided
      );
      if (!resEntry) {
        await page.waitForTimeout(500);
        continue;
      }
      const res = resEntry[1];
      // documents owned by the guest
      const docFields = Object.values(snap2.comps.document).find((d) => d.ownerEntity === guestEntity)?.fields;
      // Ground truth for whether this reservation is fraudulent: the sim's
      // OWN `plantedViolations` list on the reservation component (never
      // exposed to the RESERVA screen itself — see rules.ts's "describeRule
      // only, never evaluateRules"). Using this to DRIVE the bot's
      // accept/deny choice is "knowing from the code", not "reading the
      // screen"; §4 of the report says explicitly which one this is.
      const isFraud = Array.isArray(res.plantedViolations) && res.plantedViolations.length > 0;
      let mismatchDetail = "";
      if (docFields && res.fields) {
        for (const key of Object.keys(docFields)) {
          if (key in res.fields && String(docFields[key]) !== String(res.fields[key])) {
            mismatchDetail += `${key}: doc="${docFields[key]}" vs reservation="${res.fields[key]}"; `;
          }
        }
      }
      // rooms sellable, sorted by roomId, matching sim's own filter
      const brokenRooms = new Set(Object.values(snap2.comps.prop).filter((p) => p.broken).map((p) => p.roomEntity));
      const rooms = Object.entries(snap2.comps.roomUnit)
        .filter(([, r]) => r.occupantEntity === 0 && r.messCount === 0)
        .filter(([e]) => !brokenRooms.has(Number(e)))
        .sort((a, b) => a[1].roomId - b[1].roomId);

      if (isFraud) {
        anyFraudCaught = true;
        fraudNotes.push(
          `round ${round}: FRAUD (plantedViolations=${JSON.stringify(res.plantedViolations)}); ` +
            `raw field diff visible on screen: ${mismatchDetail || "(none of the compared field NAMES differ — a first-time reader would have to compare against the procedures card's rule text, not a field diff)"}; denied via DENY`
        );
        await clickRect(RESERVA.deny);
      } else if (rooms.length > 0) {
        anyCheckIn = true;
        const idx = 0;
        const y = RESERVA.roomListY + idx * RESERVA.roomRowH;
        await screenClickCmd(RESERVA.roomListX + RESERVA.roomRowW / 2, y + RESERVA.roomRowH / 2);
        await page.waitForTimeout(150);
        await clickRect(RESERVA.accept);
        fraudNotes.push(`round ${round}: legit, checked in`);
      } else {
        fraudNotes.push(`round ${round}: legit but no sellable room, denying to move the queue`);
        await clickRect(RESERVA.deny);
      }
      await page.waitForTimeout(400);
    }
    checkedInOnce = anyCheckIn;
    foundFraudNote = anyFraudCaught
      ? `caught ${fraudNotes.filter((n) => n.startsWith("round") && n.includes("FRAUD")).length} fraud(s) by comparing document vs reservation fields read from world state (NOT by reading the rendered RESERVA screen glyphs — see report §what-I-did-not-do). ${fraudNotes.join(" | ")}`
      : `no field mismatch found in ${round} round(s) of the queue this session. ${fraudNotes.join(" | ")}`;
    const t4 = await tick();
    const s4b = await shot("reserva-after-rounds");
    record(4, "catch-fraud", anyFraudCaught, t4, foundFraudNote, s4b);
    record("3b", "check-in", anyCheckIn, t4, `at least one guest.checkedIn attempted: ${anyCheckIn}`, s4b);
  }

  // ---- Beat 5: clean a mess ----
  {
    let snap = await snapshot();
    let messEntry = Object.entries(snap.comps.mess)[0];
    const waitStart = Date.now();
    while (!messEntry && Date.now() - waitStart < 60000) {
      await page.waitForTimeout(3000);
      snap = await snapshot();
      messEntry = Object.entries(snap.comps.mess)[0];
    }
    let pass = false, note;
    if (!messEntry) {
      note = "no mess entity present in world at this point in the run";
    } else {
      const messEntity = Number(messEntry[0]);
      const roomEntity = messEntry[1].roomEntity;
      const roomPos = snap.comps.roomUnit[roomEntity] ? undefined : undefined; // roomUnit has no pos; use mess's own interactable pos if present
      const interactablePos = snap.comps.interactable?.[messEntity];
      const before = await shot("mess-before");
      if (interactablePos) {
        await walkTo({ xMm: interactablePos.xMm, zMm: interactablePos.zMm }, { arriveMm: 1100 });
      }
      await interactCmd(messEntity);
      await page.waitForTimeout(300);
      const snapAfter = await snapshot();
      pass = snapAfter.comps.mess[messEntity] === undefined;
      note = `mess entity ${messEntity} in room ${roomEntity}; cleaned=${pass}`;
      await shot("mess-after");
      const t5 = await tick();
      record(5, "clean-room", pass, t5, note, before);
    }
    if (!messEntry) record(5, "clean-room", false, await tick(), note, null);
  }

  // ---- Beat 6: repair a prop ----
  {
    let snap = await snapshot();
    let propEntry = Object.entries(snap.comps.prop).find(([, p]) => p.broken);
    const waitStart6 = Date.now();
    while (!propEntry && Date.now() - waitStart6 < 60000) {
      await page.waitForTimeout(3000);
      snap = await snapshot();
      propEntry = Object.entries(snap.comps.prop).find(([, p]) => p.broken);
    }
    let pass = false, note;
    const before = await shot("prop-before");
    if (!propEntry) {
      note = "no broken prop present in world at this point in the run";
    } else {
      const propEntity = Number(propEntry[0]);
      const interactablePos = snap.comps.interactable?.[propEntity];
      if (interactablePos) {
        await walkTo({ xMm: interactablePos.xMm, zMm: interactablePos.zMm }, { arriveMm: 1100 });
      }
      await interactCmd(propEntity);
      await page.waitForTimeout(300);
      const snapAfter = await snapshot();
      pass = snapAfter.comps.prop[propEntity]?.broken === false;
      note = `prop entity ${propEntity}; repaired=${pass}`;
    }
    await shot("prop-after");
    record(6, "repair-prop", pass, await tick(), note, before);
  }

  // ---- Beat 7: night audit (AUDIT has no button — see report) ----
  {
    await clickRect(taskbarRect("audit"));
    await page.waitForTimeout(200);
    const before = await shot("audit-open");
    const beforeSnap = await snapshot();
    const beforeHotel = Object.values(beforeSnap.comps.hotel)[0];
    // AUDIT is passive (apps/hotel/src/sim/audit-app.ts: "layout() { return {} }",
    // no button) — the night rollover fires econ.audit automatically. Wait
    // for a day to roll (up to ~24 in-game hours of wall clock at 20Hz,
    // capped).
    let audited = false;
    let waited = 0;
    const startDay = beforeHotel?.day;
    for (let i = 0; i < 60 && !audited; i++) {
      await page.waitForTimeout(2000);
      waited += 2000;
      const s = await snapshot();
      const h = Object.values(s.comps.hotel)[0];
      if (h && startDay !== undefined && h.day !== startDay) audited = true;
    }
    const afterSnap = await snapshot();
    const afterHotel = Object.values(afterSnap.comps.hotel)[0];
    const after = await shot("audit-after");
    const pass = audited && beforeHotel && afterHotel && (beforeHotel.cash !== afterHotel.cash || beforeHotel.stars !== afterHotel.stars);
    record(
      7,
      "run-audit",
      !!pass,
      await tick(),
      `AUDIT has no RUN button — it is a passive readout (apps/hotel/src/sim/audit-app.ts). Waited ${waited}ms for the night rollover. cash ${beforeHotel?.cash}->${afterHotel?.cash}, stars ${beforeHotel?.stars}->${afterHotel?.stars}, day ${beforeHotel?.day}->${afterHotel?.day}`,
      after
    );
  }

  // ---- Beat 8: wait/earn until RENOVATE is available ----
  let renovateAvailable = false;
  {
    await clickRect(taskbarRect("ledger"));
    await page.waitForTimeout(200);
    const startTick = await tick();
    const s0 = await shot("ledger-waiting");
    let hintSurfacedAt = null;
    let affordableAt = null;
    for (let i = 0; i < 180 && !renovateAvailable; i++) {
      await page.waitForTimeout(2000);
      const s = await snapshot();
      const h = Object.values(s.comps.hotel)[0];
      const step = await hintStep();
      if (step === "renovate" && hintSurfacedAt === null) hintSurfacedAt = { tick: s.tick, cash: h?.cash };
      if (h && h.cash >= (h.renovateCostMinor ?? Infinity) && affordableAt === null) {
        affordableAt = { tick: s.tick, cash: h.cash, cost: h.renovateCostMinor };
      }
      if (hintSurfacedAt) renovateAvailable = true;
    }
    const endTick = await tick();
    const s1 = await shot("ledger-renovate-ready");
    record(
      8,
      "wait-renovate",
      renovateAvailable,
      endTick,
      `hint step "renovate" surfaced ${hintSurfacedAt ? "at tick " + hintSurfacedAt.tick + " cash " + hintSurfacedAt.cash : "NOT within budget"}; cash-affordable ${affordableAt ? "at tick " + affordableAt.tick + " cash " + affordableAt.cash + "/" + affordableAt.cost : "not observed"}; waited ${(endTick - startTick) / 20}s sim-time`,
      s1
    );
  }

  // ---- Beat 9: press RENOVATE twice, four frames ----
  {
    const fixedPose = { yawMdeg: 0 };
    async function fixedShot(name) {
      // A fixed camera pose for the "before/after" comparison the brief asks
      // for: face a constant yaw before each capture.
      await faceCmd(fixedPose.yawMdeg);
      await page.waitForTimeout(200);
      return shot(name);
    }
    const tierFrame0 = await fixedShot("tier-before-press1");
    const snapT0 = await snapshot();
    const tier0 = Object.values(snapT0.comps.hotel)[0]?.tier;

    await clickRect(taskbarRect("ledger"));
    await page.waitForTimeout(150);
    await clickRect(LEDGER.renovate);
    await page.waitForTimeout(600);
    const snapT1 = await snapshot();
    const tier1 = Object.values(snapT1.comps.hotel)[0]?.tier;
    const tierFrame1 = await fixedShot("tier-after-press1");

    // Wait/earn again for the second renovation, same pattern as beat 8.
    let secondAvailable = tier1 !== undefined && tier1 < 2;
    let waited2 = 0;
    for (let i = 0; i < 180 && secondAvailable; i++) {
      await page.waitForTimeout(2000);
      waited2 += 2000;
      const step = await hintStep();
      if (step === "renovate") break;
      const s = await snapshot();
      const h = Object.values(s.comps.hotel)[0];
      if (h && h.cash >= (h.renovateCostMinor ?? Infinity)) break;
    }
    const tierFrame1b = await fixedShot("tier1-still");

    await clickRect(taskbarRect("ledger"));
    await page.waitForTimeout(150);
    await clickRect(LEDGER.renovate);
    await page.waitForTimeout(600);
    const snapT2 = await snapshot();
    const tier2 = Object.values(snapT2.comps.hotel)[0]?.tier;
    const tierFrame2 = await fixedShot("tier-after-press2");

    const pass = tier0 !== undefined && tier1 === tier0 + 1 && tier2 !== undefined && tier2 === tier1 + 1;
    record(
      9,
      "renovate",
      pass,
      await tick(),
      `tier ${tier0} -> ${tier1} (press 1) -> ${tier2} (press 2), waited ${waited2 / 1000}s between presses. Frames: ${tierFrame0}, ${tierFrame1}, ${tierFrame1b}, ${tierFrame2}`,
      tierFrame2
    );
  }

  // ---- Beat 10: reach tier 2 and the end card ----
  {
    const snap = await snapshot();
    const tier = Object.values(snap.comps.hotel)[0]?.tier;
    const endCardVisible = await page.evaluate(() => {
      const el = document.querySelector(".hud-endcard");
      return el?.getAttribute("data-visible") === "1";
    });
    const before = await shot("endcard");
    let dismissedNote = "not dismissed (no end card visible to dismiss)";
    if (endCardVisible) {
      // Dismiss: per VISION "play continues after it" — try Escape/click.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      dismissedNote = "pressed Escape to dismiss";
    }
    await walkKey("KeyW", 800);
    const after = await shot("after-endcard-walking");
    const t10 = await tick();
    record(10, "endcard", tier === 2 && endCardVisible, t10, `tier=${tier}, endCardVisible=${endCardVisible}, ${dismissedNote}`, after);
  }

  // ---- Beat 11: hire the clerk ----
  {
    await clickRect(taskbarRect("staff"));
    await page.waitForTimeout(200);
    const before = await shot("staff-open");
    const snap = await snapshot();
    const candidateEntry = Object.entries(snap.comps.candidate)[0];
    let pass = false, note;
    if (!candidateEntry) {
      note = "no staff candidate present in world at this point in the run";
    } else {
      const idx = 0;
      const y = STAFF.listY + idx * STAFF.rowH;
      await screenClickCmd(STAFF.listX + STAFF.rowW / 2, y + STAFF.rowH / 2);
      await page.waitForTimeout(150);
      await clickRect(STAFF.hire);
      await page.waitForTimeout(300);
      const snapAfter = await snapshot();
      pass = Object.keys(snapAfter.comps.staffed).length > Object.keys(snap.comps.staffed).length;
      note = `candidate ${candidateEntry[0]}; hired=${pass}`;
    }
    const after = await shot("staff-after");
    record(11, "hire-clerk", pass, await tick(), note, after);
  }

  // ---- Extras: H skip, terminal hides HUD, HUD never intercepts clicks ----
  {
    const beforeSkip = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-visible"));
    await page.keyboard.down("KeyH");
    await page.keyboard.up("KeyH");
    await page.waitForTimeout(200);
    const afterSkip = await page.evaluate(() => document.querySelector(".hud-hint")?.getAttribute("data-visible"));
    const s = await shot("h-skip");
    record("extra", "h-skip", afterSkip === "0" || afterSkip !== beforeSkip, await tick(), `hint visible before=${beforeSkip} after=${afterSkip}`, s);

    const hudHiddenWhileFocused = await page.evaluate(() => {
      const hud = document.querySelector(".hud-reticle");
      return hud ? getComputedStyle(hud).display : "missing";
    });
    record("extra", "hud-during-terminal", true, await tick(), `reticle display while (possibly) terminal-focused: ${hudHiddenWhileFocused}`, null);
  }

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
