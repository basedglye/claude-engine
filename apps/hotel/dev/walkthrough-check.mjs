#!/usr/bin/env node
// Standalone unit checker for apps/hotel/src/render/walkthrough.ts.
//
// walkthrough.ts is pure (no DOM, no Three.js, no imports at all) so it can
// be compiled in isolation and driven with synthetic event arrays. This
// repo has no per-file test runner (see the W3 brief), so this is a
// hand-rolled PASS/FAIL script in the style of apps/hotel/scripts/test.mjs
// and packages/space/scripts/test.mjs: print one line per case, exit
// non-zero on any failure.
//
// It imports the COMPILED module, not the .ts source, because Node cannot
// run TypeScript directly here. Compile first:
//
//   npx tsc apps/hotel/src/render/walkthrough.ts \
//     --outDir <outDir> --target ES2022 --module ES2022 \
//     --moduleResolution bundler --strict --skipLibCheck
//
// then invoke this script with that outDir's walkthrough.js as argv[2].
// (The orchestrator's wiring into apps/hotel/scripts/test.mjs should do
// this compile step -- see the report's "wiring needed" section.)

import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) {
  console.error(
    "usage: node walkthrough-check.mjs <path-to-compiled-walkthrough.js>",
  );
  process.exit(2);
}

const { createWalkthrough } = await import(
  pathToFileURL(path.resolve(modulePath)).href
);

let failures = 0;

function check(name, condition) {
  if (condition) {
    console.log(`PASS: ${name}`);
  } else {
    console.log(`FAIL: ${name}`);
    failures++;
  }
}

function ev(type, payload = {}) {
  return { type, payload };
}

function baseInput(overrides = {}) {
  return {
    tick: 0,
    events: [],
    hotel: { tier: 0, cash: 0, stars: 0, day: 1 },
    nearDesk: false,
    renovateCostMinor: 75000,
    ...overrides,
  };
}

// --- Case 1: the full nine-step sequence, in order, INCLUDING both
//     renovations (0->1, then 1->2) -------------------------------------
//
// COO review fix (blocking item 1): the end card must fire on the SECOND
// renovation (to === 2, "the Grand Foyer opens"), not the first (to === 1,
// a mid-tier Hotel). A to === 1 event must re-arm step 9 rather than
// complete it, gated against the next renovateCostMinor.

{
  const w = createWalkthrough();

  check("initial step is walk-to-desk", w.current()?.id === "walk-to-desk");

  w.advance(baseInput({ nearDesk: true }));
  check("step 1 advances on nearDesk", w.current()?.id === "take-papers");

  w.advance(baseInput({ nearDesk: true, events: [ev("guest.presenting")] }));
  check(
    "step 2 advances on guest.presenting",
    w.current()?.id === "use-terminal",
  );

  w.advance(baseInput({ nearDesk: true, events: [ev("screen.appOpened")] }));
  check(
    "step 3 advances on screen.appOpened",
    w.current()?.id === "check-in",
  );

  w.advance(baseInput({ nearDesk: true, events: [ev("guest.checkedIn")] }));
  check(
    "step 4 advances on guest.checkedIn",
    w.current()?.id === "clean-room",
  );

  w.advance(baseInput({ nearDesk: true, events: [ev("room.messCleaned")] }));
  check(
    "step 5 advances on room.messCleaned",
    w.current()?.id === "repair-prop",
  );

  w.advance(baseInput({ nearDesk: true, events: [ev("prop.repaired")] }));
  check("step 6 advances on prop.repaired", w.current()?.id === "run-audit");

  w.advance(baseInput({ nearDesk: true, events: [ev("econ.audit")] }));
  check("step 7 advances on econ.audit", w.current()?.id === "hire-clerk");

  w.advance(baseInput({ nearDesk: true, events: [ev("staff.hired")] }));
  // Not affordable yet (cash 0 < renovateCostMinor 75000): COO review fix
  // (non-blocking item 2) -- the line goes silent (current() undefined)
  // rather than re-showing "hire a clerk", which the player already did.
  check(
    "step 8 done: renovate gate is silent (no line) while unaffordable",
    w.current() === undefined,
  );

  // Now the hotel can afford the FIRST renovation (0->1): the line
  // switches to "renovate" without any event.
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 0, cash: 75000, stars: 2, day: 5 },
    }),
  );
  check(
    "step 9 (renovate) shows once the first renovation is affordable",
    w.current()?.id === "renovate",
  );

  // The FIRST renovation fires (to: 1). This must NOT complete the
  // walkthrough or produce an end card -- it re-arms step 9 for the
  // Grand Foyer.
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 1, cash: 1000, stars: 2, day: 5 },
      renovateCostMinor: 250000, // next tier's cost, per RENOVATE_COST_MINOR
      events: [
        ev("hotel.renovated", { from: 0, to: 1, costMinor: 75000, day: 5, actor: "player" }),
      ],
    }),
  );
  check(
    "a to:1 renovation leaves no end card",
    w.endCard() === undefined,
  );
  check(
    "a to:1 renovation re-arms step 9: silent again (1000 < 250000)",
    w.current() === undefined,
  );

  // The rebuilt hotel earns enough for the Grand Foyer: the line comes
  // back, re-evaluated against the NEW renovateCostMinor (250000).
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 1, cash: 250000, stars: 2, day: 9 },
      renovateCostMinor: 250000,
    }),
  );
  check(
    "step 9 re-shows once the SECOND renovation is affordable",
    w.current()?.id === "renovate",
  );

  // The SECOND renovation fires (to: 2). This is the one that completes
  // the walkthrough and produces the end card.
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 2, cash: 5000, stars: 2, day: 12 },
      renovateCostMinor: 0,
      events: [
        ev("hotel.renovated", { from: 1, to: 2, costMinor: 250000, day: 12, actor: "player" }),
      ],
    }),
  );
  check("current() is undefined once finished", w.current() === undefined);
  check("endCard() appears once finished (to:2)", w.endCard() !== undefined);
  check(
    "endCard day comes from the to:2 event payload, not the to:1 one",
    w.endCard()?.day === 12,
  );
  check(
    "endCard cash comes from hotel.cash at the to:2 event",
    w.endCard()?.cashMinor === 5000,
  );

  w.dismissEndCard();
  check("dismissEndCard clears the card", w.endCard() === undefined);
}

// --- Out-of-order case A: hire the clerk long before check-in --------

{
  const w = createWalkthrough();
  w.advance(baseInput({ nearDesk: true }));
  check("[ooA] step 1 done", w.current()?.id === "take-papers");

  // Player hires the clerk (via STAFF) while still stuck on step 2 -- the
  // walkthrough must not lose this event just because the pointer is not
  // on step 8 yet.
  w.advance(
    baseInput({ nearDesk: true, events: [ev("guest.presenting"), ev("staff.hired")] }),
  );
  check(
    "[ooA] pointer still on use-terminal, not stuck",
    w.current()?.id === "use-terminal",
  );

  w.advance(baseInput({ nearDesk: true, events: [ev("screen.appOpened")] }));
  w.advance(baseInput({ nearDesk: true, events: [ev("guest.checkedIn")] }));
  w.advance(baseInput({ nearDesk: true, events: [ev("room.messCleaned")] }));
  w.advance(baseInput({ nearDesk: true, events: [ev("prop.repaired")] }));
  w.advance(baseInput({ nearDesk: true, events: [ev("econ.audit")] }));
  // hire-clerk's event already happened (fired several frames back, out
  // of order); the walkthrough must have consumed it then, not lost it --
  // so the pointer is now sitting on the renovate gate, silent (not
  // affordable), never re-asking the player to hire.
  check(
    "[ooA] already-hired clerk is not asked for again -- pointer reached the renovate gate, silent",
    w.current() === undefined,
  );
}

// --- Out-of-order case B: everything fires in one single frame -------

{
  const w = createWalkthrough();
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 0, cash: 75000, stars: 2, day: 6 },
      events: [
        ev("guest.presenting"),
        ev("screen.appOpened"),
        ev("guest.checkedIn"),
        ev("room.messCleaned"),
        ev("prop.repaired"),
        ev("econ.audit"),
        ev("staff.hired"),
      ],
    }),
  );
  check(
    "[ooB] a single frame with all events reaches renovate (affordable)",
    w.current()?.id === "renovate",
  );
}

// --- Out-of-order case C: the to:2 renovate event fires in the very same
//     frame as everything before it (should still complete immediately)

{
  const w = createWalkthrough();
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 1, cash: 300000, stars: 2, day: 3 },
      renovateCostMinor: 250000,
      events: [
        ev("guest.presenting"),
        ev("screen.appOpened"),
        ev("guest.checkedIn"),
        ev("room.messCleaned"),
        ev("prop.repaired"),
        ev("econ.audit"),
        ev("staff.hired"),
        ev("hotel.renovated", { from: 1, to: 2, costMinor: 250000, day: 3, actor: "player" }),
      ],
    }),
  );
  check(
    "[ooC] a to:2 renovate event completes even without a prior affordability frame",
    w.current() === undefined && w.endCard() !== undefined,
  );
}

// --- Out-of-order case D (THE BLOCKING FIX): a to:1 renovate event fired
//     in the very same catch-up frame as everything before it must NOT
//     complete the walkthrough. This is the exact case the COO review
//     named: the checker previously fed to:1 here and asserted
//     completion, which is the bug the review caught. -------------------

{
  const w = createWalkthrough();
  // hotel/renovateCostMinor reflect what main.ts would actually pass in
  // the SAME frame as the to:1 event: the sim has already moved the
  // hotel to tier 1 and spent the 75000, and readRenovateCostMinor now
  // reports the NEXT tier's cost (250000) -- exactly case 1's re-arm
  // setup, just delivered in one catch-up frame instead of two.
  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 1, cash: 1000, stars: 2, day: 3 },
      renovateCostMinor: 250000,
      events: [
        ev("guest.presenting"),
        ev("screen.appOpened"),
        ev("guest.checkedIn"),
        ev("room.messCleaned"),
        ev("prop.repaired"),
        ev("econ.audit"),
        ev("staff.hired"),
        ev("hotel.renovated", { from: 0, to: 1, costMinor: 75000, day: 3, actor: "player" }),
      ],
    }),
  );
  check(
    "[ooD, BLOCKING FIX] a to:1 renovate event does NOT complete the walkthrough",
    w.current() === undefined && w.endCard() === undefined,
  );
}

// --- Skip case ----------------------------------------------------------

{
  const w = createWalkthrough();
  w.advance(baseInput({ nearDesk: true }));
  check("[skip] step 1 done before skip", w.current()?.id === "take-papers");

  w.skip();
  check("[skip] skipped() is true", w.skipped() === true);
  check("[skip] current() is undefined after skip", w.current() === undefined);

  w.advance(baseInput({ nearDesk: true, events: [ev("guest.presenting")] }));
  check(
    "[skip] advance() after skip does nothing",
    w.current() === undefined,
  );

  w.advance(
    baseInput({
      nearDesk: true,
      hotel: { tier: 2, cash: 75000, stars: 2, day: 9 },
      events: [ev("hotel.renovated", { from: 1, to: 2, costMinor: 250000, day: 9, actor: "player" })],
    }),
  );
  check(
    "[skip] endCard() stays undefined forever after skip",
    w.endCard() === undefined,
  );
}

// --- Idempotence: an empty-events advance() with unchanged state -------

{
  const w = createWalkthrough();
  w.advance(baseInput({ nearDesk: true }));
  const before = w.current()?.id;
  w.advance(baseInput({ nearDesk: true, events: [] }));
  check(
    "idempotent: empty-event advance() with unchanged state does not move",
    w.current()?.id === before,
  );
}

console.log("");
if (failures > 0) {
  console.log(`${failures} case(s) FAILED`);
  process.exit(1);
} else {
  console.log("All cases passed.");
  process.exit(0);
}
