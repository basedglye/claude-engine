// Host-side walkthrough engine. Pure logic: no DOM, no Three.js, no sim
// imports (not even types — the shapes below are self-contained so this
// file can be compiled and unit-tested in isolation). Fed by main.ts each
// frame with the tick's new sim events and a snapshot of relevant state;
// never touches the sim itself. See apps/hotel/docs/VISION-ALPHA.md
// ("The walkthrough") and CLAUDE.md invariant 2 (no timers, no
// Math.random — this file has neither).

export interface WalkthroughStep {
  /** Stable id, used by tests and by the HUD's data attribute. */
  id: string;
  /** i18n key; the HUD renders `t(textKey)`. */
  textKey: string;
}

export interface WalkthroughHotel {
  tier: number;
  cash: number;
  stars: number;
  day: number;
}

export interface WalkthroughInput {
  tick: number;
  events: readonly { type: string; payload: Record<string, unknown> }[];
  hotel: WalkthroughHotel | undefined;
  nearDesk: boolean;
  /** Cost of the next renovation in minor units, 0 at max tier. */
  renovateCostMinor: number;
}

export interface EndCard {
  titleKey: string; // "endcard.title"
  bodyKey: string; // "endcard.body", with {day} and {cash} placeholders
  day: number;
  cashMinor: number;
}

export interface Walkthrough {
  /** Feed the frame's new events and state. Idempotent for an empty
   *  event list plus unchanged state. Never throws. */
  advance(input: WalkthroughInput): void;
  /** The current step, or undefined when finished or skipped. */
  current(): WalkthroughStep | undefined;
  /** The end card, once tier 2 is reached, until dismissed. */
  endCard(): EndCard | undefined;
  dismissEndCard(): void;
  /** Turns the walkthrough off for the rest of the session. */
  skip(): void;
  skipped(): boolean;
}

/** Fixed step list — do not invent steps or reorder them (BREAKDOWN §1 /
 *  brief §4.2). Index in this array IS the step number (1-based in the
 *  brief's table, 0-based here). */
const STEPS: readonly WalkthroughStep[] = [
  { id: "walk-to-desk", textKey: "walkthrough.desk" }, // 0
  { id: "take-papers", textKey: "walkthrough.papers" }, // 1
  { id: "use-terminal", textKey: "walkthrough.terminal" }, // 2
  { id: "check-in", textKey: "walkthrough.checkin" }, // 3
  { id: "clean-room", textKey: "walkthrough.clean" }, // 4
  { id: "repair-prop", textKey: "walkthrough.repair" }, // 5
  { id: "run-audit", textKey: "walkthrough.audit" }, // 6
  { id: "hire-clerk", textKey: "walkthrough.hire" }, // 7
  { id: "renovate", textKey: "walkthrough.renovate" }, // 8
];

const STEP_RENOVATE = 8;

/** The sim event type that completes each event-driven step. Step 0
 *  (walk-to-desk) is state-driven (`nearDesk`), not event-driven, and has
 *  no entry here. */
const COMPLETING_EVENT: Readonly<Record<number, string>> = {
  1: "guest.presenting",
  2: "screen.appOpened",
  3: "guest.checkedIn",
  4: "room.messCleaned",
  5: "prop.repaired",
  6: "econ.audit",
  7: "staff.hired",
  8: "hotel.renovated",
};

export function createWalkthrough(): Walkthrough {
  // Per-step completion, independent of the display pointer below, so an
  // event for a step other than the one currently displayed is never
  // lost: "a player who did things out of order is never stuck behind a
  // step they already satisfied" (brief §4.2).
  const stepDone = new Array<boolean>(STEPS.length).fill(false);
  let pointer = 0; // index of the first not-yet-done step, or STEPS.length
  let skippedFlag = false;
  let done = false;
  let card: EndCard | undefined;
  let renovateAffordable = false;
  let renovatedPayload: Record<string, unknown> | undefined;

  function markFromEvents(
    events: readonly { type: string; payload: Record<string, unknown> }[],
  ): void {
    for (const e of events) {
      for (let i = 1; i < STEPS.length; i++) {
        if (stepDone[i] || COMPLETING_EVENT[i] !== e.type) continue;
        if (i === STEP_RENOVATE) {
          // Two renovations happen in the alpha (0->1, then 1->2). Step 9
          // is the game's closing beat and must fire only on the SECOND
          // one — the COO review fix: gate on payload.to === 2, not on
          // "any hotel.renovated event". A to === 1 event intentionally
          // marks nothing here, which is what re-arms the step: pointer
          // stays at STEP_RENOVATE, and current()/canShowRenovateStep
          // re-evaluate against the *next* frame's (now tier-1) hotel and
          // renovateCostMinor, so the player is prompted again for the
          // Grand Foyer once they can afford it.
          if (e.payload["to"] !== 2) continue;
          renovatedPayload = e.payload;
        }
        stepDone[i] = true;
      }
    }
  }

  function advancePointer(): void {
    while (pointer < STEPS.length && stepDone[pointer]) pointer++;
  }

  function advance(input: WalkthroughInput): void {
    if (skippedFlag || done) return;

    if (input.nearDesk === true) stepDone[0] = true;
    markFromEvents(input.events);
    renovateAffordable = canShowRenovateStep(input);

    advancePointer();

    if (pointer >= STEPS.length) {
      const payload = renovatedPayload;
      const day =
        payload && typeof payload["day"] === "number"
          ? (payload["day"] as number)
          : (input.hotel?.day ?? 0);
      card = {
        titleKey: "endcard.title",
        bodyKey: "endcard.body",
        day,
        cashMinor: input.hotel?.cash ?? 0,
      };
      done = true;
    }
  }

  function current(): WalkthroughStep | undefined {
    if (skippedFlag || done) return undefined;
    if (pointer >= STEPS.length) return undefined;

    if (pointer === STEP_RENOVATE && !renovateAffordable) {
      // Not affordable yet: show nothing (COO review resolution of the
      // brief's own ambiguity — "step 8's text" would re-ask the player
      // to hire a clerk they already hired, since reaching pointer 8
      // requires stepDone[7] === true). The next act genuinely is "keep
      // running the hotel", which this game's no-HUD design has no line
      // for.
      return undefined;
    }

    return STEPS[pointer];
  }

  function endCard(): EndCard | undefined {
    if (skippedFlag) return undefined;
    return card;
  }

  function dismissEndCard(): void {
    card = undefined;
  }

  function skip(): void {
    skippedFlag = true;
    card = undefined;
  }

  function skipped(): boolean {
    return skippedFlag;
  }

  return { advance, current, endCard, dismissEndCard, skip, skipped };
}

/** Step 9 is only *shown* once the hotel can afford it. */
function canShowRenovateStep(input: WalkthroughInput): boolean {
  const hotel = input.hotel;
  if (!hotel) return false;
  return input.renovateCostMinor > 0 && hotel.cash >= input.renovateCostMinor;
}
