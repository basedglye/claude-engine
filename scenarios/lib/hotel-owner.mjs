// The owner bot: a scenario-local BotDriver that PLAYS the hotel through
// the public command factories — walking, opening doors, talking to guests,
// working RESERVA, wiping messes, repairing props, setting rates and
// hiring. Shared by the H2a gates (docs/PHASE-H2.md exit criteria 1-4).
//
// WHAT MAKES THIS HONEST. A bot in this repo may only READ the world
// (IWorld) and RETURN intents; it never touches a Sim. So every action here
// is the same command a human produces: `face` + `move` to walk, `interact`
// to open a door or take a guest's papers, `screen.click` at coordinates
// derived from `hotelShell.layout()` to work the terminal. There is no
// teleport, no direct component write, and no privileged "owner" command —
// if the sim would refuse a player, it refuses this bot.
//
// The pathing deserves a note. The bot calls the sim's OWN
// `findJitteredPath` to pick its next cell, which is not cheating: a human
// looks at the room and walks around the furniture, and reusing the sim's
// occupiability rule is how a scripted walker avoids re-deriving (and
// getting subtly wrong) what counts as walkable. The commands it produces
// are still plain `face`/`move` at the same speed a human's are, and the
// sim still resolves the collision.
//
// Bot-local state is fine and is NOT sim state: the harness records the
// commands a bot emits, and `--verify-replay` replays that command log
// against a fresh sim without running any bot code.
import { findJitteredPath } from "../../apps/hotel/dist-game/sim/nav.js";
import {
  faceCommand,
  moveCommand,
  interactCommand,
  screenClickCommand,
  hotelShell,
  buildScreenWorldView,
} from "../../apps/hotel/dist-game/sim/game.js";
import { H1_RULES, evaluateRules, rulesForStars } from "../../apps/hotel/dist-game/sim/rules.js";
import {
  SEGMENT_WILLINGNESS_MINOR,
  SEGMENT_MIN_HOTEL_TIER,
  RATE_STEP_MINOR,
  MIN_RATE_MINOR,
} from "../../apps/hotel/dist-game/sim/economy.js";
import { atan2Mdeg, cellOfMm, CELL_SIZE_MM } from "../../packages/space/dist/index.js";

export const OWNER_ACTOR = "player";

/** IWorld exposes `entities()` + `getComponent` only, so every lookup is an
 *  ascending-entity-id scan — deterministic by construction. */
export function scan(world, component) {
  const out = [];
  for (const entity of world.entities()) {
    const value = world.getComponent(entity, component);
    if (value !== undefined) out.push([entity, value]);
  }
  return out;
}

export function one(world, component) {
  const found = scan(world, component);
  return found.length > 0 ? found[0] : undefined;
}

function cellMm(cx, cz) {
  return { xMm: cx * CELL_SIZE_MM + CELL_SIZE_MM / 2, zMm: cz * CELL_SIZE_MM + CELL_SIZE_MM / 2 };
}

function distSq(a, b) {
  const dx = a.xMm - b.xMm;
  const dz = a.zMm - b.zMm;
  return dx * dx + dz * dz;
}

/**
 * Everything the owner needs about itself this tick.
 */
function self(world, playerEntity) {
  const pos = world.getComponent(playerEntity, "pos");
  const yaw = world.getComponent(playerEntity, "yaw");
  return { pos, yaw };
}

/**
 * The bot. `plan` is a list of scheduled one-off actions keyed by day; the
 * rest is a priority policy evaluated every tick.
 */
export function makeOwnerBot(opts) {
  const {
    floor,
    grid,
    playerEntity,
    /** Optional per-day one-offs: { day, action } where action is a string
     *  this file understands ("set-rate-down", "hire-first"). */
    schedule = [],
    /** Turn individual behaviours off, for gates that want a narrow bot. */
    enable = {},
    /** [fromTick, toTick): the owner does nothing at all. `zen-clean` uses
     *  this to dawdle in the middle of a cleaning round and then assert
     *  that dawdling cost nothing. */
    idleWindow = null,
    /** Once a clerk is on the payroll, walk to this cell and stay there —
     *  `first-hire` asserts the player is not at the desk afterwards, and
     *  "walked away" has to be a real walk, not an assumption. */
    afterHireCell = null,
    /** Once, when a guest is presenting and some room is vacant but NOT
     *  ready, submit a `desk.decision` accepting onto that room. It must be
     *  refused. `zen-clean` uses this to prove the block exists from the
     *  OTHER entry point — the command form, which RESERVA's filtered room
     *  list would never let a screen click reach. */
    probeNotReadyRoom = false,
    /** Off by default (no existing scenario changes behaviour). When true:
     *  whenever LEDGER's `renovateAvailable` is true, walk to the desk, open
     *  LEDGER, and click RENOVATE — same one-press action a human takes.
     *  Once a renovation lands, also raise every rate toward the new
     *  ceiling (via PRICER's existing RATE + click) so the higher-tier
     *  economy actually pays for itself, rather than sitting at the old
     *  rate under a new, higher cap. */
    renovate = false,
  } = opts;

  const behaviour = {
    desk: enable.desk !== false,
    clean: enable.clean !== false,
    repair: enable.repair !== false,
    hire: enable.hire !== false,
    rate: enable.rate !== false,
    ...enable,
  };

  const deskCell = cellOfMm(grid, floor.desk.xMm, floor.desk.zMm);
  const queueHeadCell = floor.desk.queueCells[0];
  const doorCells = new Map(); // cellIndex -> doorIndex
  floor.doors.forEach((d) => {
    for (const c of floor.portals.portals[d.doorIndex]?.cells ?? []) {
      doorCells.set(c.cz * grid.width + c.cx, d.doorIndex);
    }
  });

  /** Where the owner stands to work the desk: the queue head's neighbour on
   *  the desk side. Derived once, from committed floor data. */
  const deskStandCell = pickStandCell();
  function pickStandCell() {
    // The nearest cell to the desk from which BOTH the desk decision radius
    // and the queue head are in reach — the same two constraints the sim
    // checks on the clerk.
    let best = null;
    for (let dz = -6; dz <= 6; dz++) {
      for (let dx = -6; dx <= 6; dx++) {
        const cx = deskCell.cx + dx;
        const cz = deskCell.cz + dz;
        if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) continue;
        const mm = cellMm(cx, cz);
        if (distSq(mm, { xMm: floor.desk.xMm, zMm: floor.desk.zMm }) > 1500 * 1500) continue;
        if (distSq(mm, cellMm(queueHeadCell.cx, queueHeadCell.cz)) > 1400 * 1400) continue;
        // Reachable at all?
        const path = findJitteredPath(grid, { cx: deskCell.cx, cz: deskCell.cz }, { cx, cz }, () => true, 1);
        if (!path) continue;
        const d = distSq(mm, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
        const idx = cz * grid.width + cx;
        if (best === null || d < best.d || (d === best.d && idx < best.idx)) best = { cell: { cx, cz }, d, idx };
      }
    }
    return best ? best.cell : { cx: queueHeadCell.cx, cz: queueHeadCell.cz };
  }

  /** Face `target` (world mm) and, if a door blocks the next step, open it.
   *  Returns intents to walk one tick toward `goalCell`, or [] if arrived. */
  function walkToward(world, goalCell) {
    const { pos } = self(world, playerEntity);
    if (!pos) return [];
    const here = cellOfMm(grid, pos.xMm, pos.zMm);
    if (here.cx === goalCell.cx && here.cz === goalCell.cz) return [];
    const path = findJitteredPath(grid, here, goalCell, () => true, 1);
    if (!path || path.length < 2) return [];

    // A door on the next couple of cells has to be opened by hand — the
    // player is not a guest and does not shoulder doors open.
    for (let i = 1; i < Math.min(path.length, 4); i++) {
      const idx = path[i].cz * grid.width + path[i].cx;
      const doorIndex = doorCells.get(idx);
      if (doorIndex === undefined) continue;
      const doorEntry = scan(world, "door").find(([, d]) => d.doorIndex === doorIndex);
      if (!doorEntry || doorEntry[1].open) continue;
      const interactable = world.getComponent(doorEntry[0], "interactable");
      if (!interactable) continue;
      const dxMm = interactable.xMm - pos.xMm;
      const dzMm = interactable.zMm - pos.zMm;
      const bearing = atan2Mdeg(dxMm, dzMm);
      if (dxMm * dxMm + dzMm * dzMm > 1400 * 1400) {
        // Not close enough yet — keep walking, facing the door.
        return [
          { type: "face", payload: faceCommand(0, bearing).payload },
          { type: "move", payload: moveCommand(0, 1000, 0).payload },
        ];
      }
      return [
        { type: "face", payload: faceCommand(0, bearing).payload },
        { type: "interact", payload: interactCommand(0, doorEntry[0]).payload },
      ];
    }

    const next = path[1];
    const target = cellMm(next.cx, next.cz);
    const bearing = atan2Mdeg(target.xMm - pos.xMm, target.zMm - pos.zMm);
    return [
      { type: "face", payload: faceCommand(0, bearing).payload },
      { type: "move", payload: moveCommand(0, 1000, 0).payload },
    ];
  }

  /** Face `entity` and interact, or walk to it first. `radiusMm` is the
   *  range the sim will check. */
  function reachAndInteract(world, entity, targetMm) {
    const { pos } = self(world, playerEntity);
    if (!pos) return [];
    const bearing = atan2Mdeg(targetMm.xMm - pos.xMm, targetMm.zMm - pos.zMm);
    if (distSq(pos, targetMm) <= 1200 * 1200) {
      return [
        { type: "face", payload: faceCommand(0, bearing).payload },
        { type: "interact", payload: interactCommand(0, entity).payload },
      ];
    }
    const stand = standCellNear(world, targetMm);
    if (!stand) return [];
    const step = walkToward(world, stand);
    if (step.length > 0) return step;
    // Standing on the chosen cell but still out of interact range: the
    // player stops wherever the move resolved, not at the cell centre, so
    // "my cell is the goal cell" is not the same as "I am close enough".
    // Nudge straight at the target; collision stops us at the wall.
    return [
      { type: "face", payload: faceCommand(0, bearing).payload },
      { type: "move", payload: moveCommand(0, 1000, 0).payload },
    ];
  }

  /**
   * The nearest cell the owner can actually STAND on that puts `targetMm`
   * in interact range.
   *
   * Walking to the target's own cell is wrong and was the second thing that
   * stalled this bot: a mess sits wherever the checkout dropped it, and a
   * cell one step from a bedroom wall fails the 8-neighbour clearance rule
   * a 300mm-radius body needs, so A* refuses it as a goal and the bot stood
   * still with eleven messes on the floor. A person does not walk ONTO the
   * pizza box; they walk up to it. Searched in ascending (distance from the
   * player, cell index) order for determinism.
   */
  function standCellNear(world, targetMm) {
    const { pos } = self(world, playerEntity);
    if (!pos) return null;
    const here = cellOfMm(grid, pos.xMm, pos.zMm);
    const targetCell = cellOfMm(grid, targetMm.xMm, targetMm.zMm);
    const REACH_CELLS = 4;
    let best = null;
    for (let dz = -REACH_CELLS; dz <= REACH_CELLS; dz++) {
      for (let dx = -REACH_CELLS; dx <= REACH_CELLS; dx++) {
        const cx = targetCell.cx + dx;
        const cz = targetCell.cz + dz;
        if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) continue;
        const mm = cellMm(cx, cz);
        // 900mm, not the full 1200mm interact range: the player stops
        // wherever the move resolved rather than at the cell centre, so a
        // stand cell chosen right at the limit can leave them just out of
        // reach with nowhere further to walk.
        if (distSq(mm, targetMm) > 900 * 900) continue;
        if (!findJitteredPath(grid, here, { cx, cz }, () => true, 1)) continue;
        const d = (cx - here.cx) * (cx - here.cx) + (cz - here.cz) * (cz - here.cz);
        const idx = cz * grid.width + cx;
        if (best === null || d < best.d || (d === best.d && idx < best.idx)) best = { cell: { cx, cz }, d, idx };
      }
    }
    return best ? best.cell : null;
  }

  function terminalEntity(world) {
    const found = one(world, "terminal");
    return found ? found[0] : undefined;
  }

  function shellRects(world, terminal) {
    const screenApp = world.getComponent(terminal, "screenApp");
    if (!screenApp) return {};
    return hotelShell.layout(screenApp.state, buildScreenWorldView(world));
  }

  function clickIntent(rects, key) {
    const rect = rects[key];
    if (!rect) return undefined;
    const px = rect.x + Math.floor(rect.w / 2);
    const py = rect.y + Math.floor(rect.h / 2);
    return { type: "screen.click", payload: screenClickCommand(0, px, py).payload };
  }

  // -- bot-local bookkeeping (NOT sim state; replay never runs this) --
  const doneDays = new Set();
  let lastAppOpened = "";
  let probedNotReady = false;
  // Anti-wedge counter for the chore loops: `alpha-loop`'s 14-day run can
  // pile up a heavier mess/prop backlog than one-man-week ever produces,
  // and reachAndInteract's straight-line nudge fallback can occasionally
  // ping-pong on a single stubborn target instead of converging. Tracked
  // by (position, target) so a genuinely slow approach is never mistaken
  // for a wedge — only "same target, hasn't actually moved" counts.
  let choreStuckRefPos = null;
  let choreStuckRefTick = 0;
  let choreStuckTarget = -1;
  let choreSkipIndex = 0;
  const CHORE_WEDGE_WINDOW_TICKS = 60;
  const CHORE_WEDGE_NET_MM = 300;

  return {
    actor: OWNER_ACTOR,
    act(world, tick) {
      if (idleWindow && tick >= idleWindow[0] && tick < idleWindow[1]) return [];
      const hotelEntry = one(world, "hotel");
      if (!hotelEntry) return [];
      const hotel = hotelEntry[1];
      const terminal = terminalEntity(world);
      if (terminal === undefined) return [];
      const terminalComp = world.getComponent(terminal, "terminal");
      const focused = terminalComp && terminalComp.focusedBy === OWNER_ACTOR;
      const { pos } = self(world, playerEntity);
      if (!pos) return [];

      /** Picks the target this tick's chore should pursue, and detects a
       *  wedge: net displacement near zero over a rolling window while
       *  chasing the SAME target (catches both "stopped dead" and the
       *  ping-pong a straight-line nudge can fall into against certain
       *  geometry). On a detected wedge, `choreSkipIndex` advances so the
       *  NEXT call rotates to a different candidate — a heavier backlog
       *  than one-man-week/zen-clean ever produce is exactly what
       *  `alpha-loop`'s 14-day run can build up, and one stubborn item must
       *  never wedge the whole round forever. */
      function pickChoreTarget(list, entityPos, tick) {
        if (list.length === 0) {
          choreStuckTarget = -1;
          return undefined;
        }
        const target = list[choreSkipIndex % list.length];
        if (target[0] !== choreStuckTarget) {
          choreStuckTarget = target[0];
          choreStuckRefPos = entityPos;
          choreStuckRefTick = tick;
          return target;
        }
        if (tick - choreStuckRefTick >= CHORE_WEDGE_WINDOW_TICKS) {
          const dx = entityPos.xMm - choreStuckRefPos.xMm;
          const dz = entityPos.zMm - choreStuckRefPos.zMm;
          if (dx * dx + dz * dz < CHORE_WEDGE_NET_MM * CHORE_WEDGE_NET_MM) {
            choreSkipIndex++;
            choreStuckTarget = -1;
            return list[choreSkipIndex % list.length];
          }
          choreStuckRefPos = entityPos;
          choreStuckRefTick = tick;
        }
        return target;
      }

      /** The wipe-then-repair round, or null if there is nothing to do. */
      function choreIntents(w, isFocused, entityPos, tick) {
        if (behaviour.clean) {
          const messes = scan(w, "mess");
          if (messes.length > 0) {
            if (isFocused) return [{ type: "screen.blur", payload: {} }];
            const target = pickChoreTarget(messes, entityPos, tick);
            const mPos = target && w.getComponent(target[0], "pos");
            if (mPos) return reachAndInteract(w, target[0], mPos);
          }
        }
        if (behaviour.repair) {
          const broken = scan(w, "prop").filter(([, p]) => p.broken);
          if (broken.length > 0) {
            if (isFocused) return [{ type: "screen.blur", payload: {} }];
            const target = pickChoreTarget(broken, entityPos, tick);
            const pPos = target && w.getComponent(target[0], "pos");
            if (pPos) return reachAndInteract(w, target[0], pPos);
          }
        }
        return null;
      }

      // ---- scheduled one-offs, at the terminal ----
      for (const item of schedule) {
        const key = `${item.day}:${item.action}`;
        if (hotel.day !== item.day || doneDays.has(key)) continue;
        if (item.action === "set-rate-down" && behaviour.rate) {
          if (!focused) return reachAndInteract(world, terminal, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
          const rects = shellRects(world, terminal);
          const state = world.getComponent(terminal, "screenApp").state;
          if (state.openAppId !== "pricer") {
            const open = clickIntent(rects, "taskbar:pricer");
            return open ? [open] : [];
          }
          const tier = clickIntent(rects, "app:tier:1");
          if (state.appStates.pricer?.selectedTier !== 1 && tier) return [tier];
          const down = clickIntent(rects, "app:down");
          doneDays.add(key);
          return down ? [down] : [];
        }
      }

      // ---- hiring: interview whoever is waiting, then HIRE ----
      if (behaviour.hire) {
        // ONE clerk. The first candidate is hired; every candidate after
        // that is passed — which is also how the PASS branch gets exercised
        // in a run that is otherwise all yes.
        const alreadyStaffed = scan(world, "staffed").length > 0;
        const interviewing = scan(world, "candidate").find(([, c]) => c.state === "interviewing");
        if (interviewing) {
          if (!focused) return reachAndInteract(world, terminal, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
          const state = world.getComponent(terminal, "screenApp").state;
          const rects = shellRects(world, terminal);
          if (state.openAppId !== "staff") {
            const open = clickIntent(rects, "taskbar:staff");
            return open ? [open] : [];
          }
          if (state.appStates.staff?.selectedCandidateEntity !== interviewing[0]) {
            const select = clickIntent(rects, `app:candidate:${interviewing[0]}`);
            return select ? [select] : [];
          }
          const decide = clickIntent(rects, alreadyStaffed ? "app:pass" : "app:hire");
          return decide ? [decide] : [];
        }
        const waiting = scan(world, "candidate").find(([, c]) => c.state === "waiting");
        if (waiting) {
          const wPos = world.getComponent(waiting[0], "pos");
          if (wPos) {
            if (focused) return [{ type: "screen.blur", payload: {} }];
            return reachAndInteract(world, waiting[0], wPos);
          }
        }
      }

      // ---- the desk: present, then decide through RESERVA ----
      // Once a clerk is on the payroll and the owner has been told to walk
      // away, the desk is THEIRS. Without this the owner would keep
      // deciding over the clerk's shoulder, which is both wrong for the
      // beat and would make "the clerk worked unaided" unprovable.
      const standDown = afterHireCell !== null && scan(world, "staffed").length > 0;
      if (behaviour.desk && !standDown) {
        const presenting = scan(world, "guest").find(([, g]) => g.state === "presenting");

        if (probeNotReadyRoom && !probedNotReady && presenting) {
          const sellable = new Set(buildScreenWorldView(world).data.rooms.map((r) => r.roomEntity));
          const notReady = scan(world, "roomUnit").find(
            ([entity, room]) => room.occupantEntity === 0 && !sellable.has(entity),
          );
          const resEntry = scan(world, "reservation").find(([, r]) => r.guestEntity === presenting[0] && !r.decided);
          if (notReady && resEntry) {
            const here = cellOfMm(grid, pos.xMm, pos.zMm);
            if (here.cx !== deskStandCell.cx || here.cz !== deskStandCell.cz) {
              return walkToward(world, deskStandCell);
            }
            probedNotReady = true;
            return [
              {
                type: "desk.decision",
                payload: { reservationEntity: resEntry[0], accept: true, roomEntity: notReady[0] },
              },
            ];
          }
        }
        if (presenting) {
          const resEntry = scan(world, "reservation").find(([, r]) => r.guestEntity === presenting[0] && !r.decided);
          if (resEntry) {
            // Work out the verdict BEFORE deciding to walk to the terminal.
            // Focusing first and only then discovering there is no sellable
            // room produces a focus/blur cycle that runs forever: the desk
            // branch focuses, the chore fallback blurs, repeat. (Observed —
            // the bot stood on one cell emitting `screen.blur` for 40,000
            // ticks while eleven messes piled up behind it.) The view is
            // readable without focus, so read it first.
            const view = buildScreenWorldView(world);
            const docs = scan(world, "document")
              .filter(([, d]) => d.ownerEntity === presenting[0])
              .map(([, d]) => ({ docType: d.docType, fields: d.fields }));
            const lists = {};
            for (const [, list] of scan(world, "noticeList")) lists[list.listId] = list.values;
            const violations = evaluateRules(
              rulesForStars(H1_RULES, hotel.stars),
              docs,
              resEntry[1].fields,
              { day: hotel.day, lists },
            );
            const room = view.data.rooms[0];
            const canDecide = violations.length > 0 || room !== undefined;
            if (!canDecide) {
              // The guest is fine, but every room is dirty or broken. The
              // only thing that changes that is walking upstairs — the
              // one-man-show squeeze, made literal.
              const chore = choreIntents(world, focused, pos, tick);
              if (chore) return chore;
              return [];
            }
            if (!focused) return reachAndInteract(world, terminal, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
            const state = world.getComponent(terminal, "screenApp").state;
            const rects = shellRects(world, terminal);
            if (state.openAppId !== "reserva") {
              const open = clickIntent(rects, "taskbar:reserva");
              lastAppOpened = "reserva";
              return open ? [open] : [];
            }
            if (violations.length > 0) {
              const deny = clickIntent(rects, "app:deny");
              return deny ? [deny] : [];
            }
            if (state.appStates.reserva?.selectedRoomEntity !== room.roomEntity) {
              const select = clickIntent(rects, `app:room:${room.roomEntity}`);
              return select ? [select] : [];
            }
            const accept = clickIntent(rects, "app:accept");
            return accept ? [accept] : [];
          }
        }

        // Nobody presenting: invite the queue head once it has arrived, but
        // only if no hired clerk is on duty (then the desk is theirs).
        const hasClerk = scan(world, "staffed").length > 0;
        if (!hasClerk) {
          const head = scan(world, "guest").find(([entity, g]) => {
            if (g.state !== "queued" || g.queueIndex !== 0) return false;
            const gPos = world.getComponent(entity, "pos");
            if (!gPos) return false;
            const c = cellOfMm(grid, gPos.xMm, gPos.zMm);
            return c.cx === queueHeadCell.cx && c.cz === queueHeadCell.cz;
          });
          if (head) {
            if (focused) return [{ type: "screen.blur", payload: {} }];
            const hPos = world.getComponent(head[0], "pos");
            return reachAndInteract(world, head[0], hPos);
          }
        }
      }

      // ---- the zen loops: wipe, then repair. Kept at the SAME priority it
      //      always had — a renovation or a rate change is never worth
      //      letting the house go to pieces, so `renovate` below is
      //      strictly lower priority than a chore that exists right now. ----
      const chore = choreIntents(world, focused, pos, tick);
      if (chore) return chore;

      // ---- renovate whenever it is actually affordable, then price like a
      //      competent human — never "chase the ceiling". A human who
      //      overprices their own guests loses stars, so the target rate is
      //      the LOWEST willingness among the segments actually eligible to
      //      book at the current hotel tier (read from economy.js, never
      //      hardcoded), clamped to the tier's ceiling. Only reached once
      //      desk service, hiring and every open chore have nothing to do
      //      this tick. ----
      if (renovate) {
        const view = buildScreenWorldView(world);
        const ledgerView = view.data.ledger;
        const pricingView = view.data.pricing;

        if (ledgerView.renovateAvailable) {
          if (!focused) return reachAndInteract(world, terminal, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
          const state = world.getComponent(terminal, "screenApp").state;
          const rects = shellRects(world, terminal);
          if (state.openAppId !== "ledger") {
            const open = clickIntent(rects, "taskbar:ledger");
            return open ? [open] : [];
          }
          const press = clickIntent(rects, "app:renovate");
          return press ? [press] : [];
        }

        // The lowest willingness among segments eligible at THIS hotel
        // tier — e.g. family ($50) at tiers 0-1, still family at tier 2
        // unless a later tier ever drops family (it does not this phase).
        // Never assume; derive from SEGMENT_MIN_HOTEL_TIER + the real
        // willingness table every tick, so a constants retune is picked up
        // automatically.
        const eligibleWillingness = Object.keys(SEGMENT_WILLINGNESS_MINOR)
          .filter((seg) => (SEGMENT_MIN_HOTEL_TIER[seg] ?? 0) <= hotel.tier)
          .map((seg) => SEGMENT_WILLINGNESS_MINOR[seg]);
        const lowestWillingness =
          eligibleWillingness.length > 0 ? Math.min(...eligibleWillingness) : pricingView.maxRateMinor;
        const rawTarget = Math.min(lowestWillingness, pricingView.maxRateMinor);
        // Rates are step-quantised (isValidRate/isValidRateForHotelTier) —
        // round DOWN so the target is never itself an overprice, and never
        // below the floor.
        const steppedTarget = Math.floor(rawTarget / RATE_STEP_MINOR) * RATE_STEP_MINOR;
        const targetRateMinor = Math.max(MIN_RATE_MINOR, steppedTarget);

        const tiers = Object.keys(pricingView.rateByTier)
          .map((k) => Number.parseInt(k, 10))
          .sort((a, b) => a - b);
        // A room tier whose CURRENT rate is already outside [min, max] for
        // the current hotel tier (e.g. the tier-2 room's committed opening
        // rate, $80, is above hotel-tier-0/1's $60/$65 ceiling) can never
        // be walked toward target one step at a time: PRICER's own guard
        // refuses any click whose result is still out of bounds, so
        // "current !== target" alone made the bot click the SAME refused
        // "down" forever — an infinite loop that left the terminal focused
        // and locked a hired clerk out of the desk for the rest of the
        // run (measured directly: fraudRatePermille 200's real desk load
        // never mattered, the bot was stuck on this before a single guest
        // could even be invited). Only treat a tier as reachable-this-tick
        // if the very next step actually lands inside bounds; an
        // unreachable tier is left alone until a renovation raises the
        // ceiling enough to admit its first step.
        const offTarget = tiers.find((t) => {
          const current = pricingView.rateByTier[String(t)];
          if (current === targetRateMinor) return false;
          const next = current < targetRateMinor ? current + pricingView.stepMinor : current - pricingView.stepMinor;
          return next >= pricingView.minRateMinor && next <= pricingView.maxRateMinor;
        });
        if (offTarget !== undefined) {
          if (!focused) return reachAndInteract(world, terminal, { xMm: floor.desk.xMm, zMm: floor.desk.zMm });
          const state = world.getComponent(terminal, "screenApp").state;
          const rects = shellRects(world, terminal);
          if (state.openAppId !== "pricer") {
            const open = clickIntent(rects, "taskbar:pricer");
            return open ? [open] : [];
          }
          if (state.appStates.pricer?.selectedTier !== offTarget) {
            const select = clickIntent(rects, `app:tier:${offTarget}`);
            return select ? [select] : [];
          }
          const current = pricingView.rateByTier[String(offTarget)];
          const step = clickIntent(rects, current < targetRateMinor ? "app:up" : "app:down");
          return step ? [step] : [];
        }

        // Nothing left to do on the terminal this tick (no renovation
        // available, every rate already at target). If a PRIOR tick left
        // the screen focused (LEDGER/PRICER open) while walking here or
        // finishing a click, blur it now rather than leave it held — a
        // hired clerk's `staffBrainSystem` stands down for as long as
        // ANY other actor holds terminal focus (`focusedBy !== "" &&
        // focusedBy !== the clerk's actor`), so an owner that parks at
        // the desk with the screen still open after finishing renovate/
        // pricer business silently locks the clerk out of the desk
        // forever — measured: the queue sat at 8/8 with nobody
        // presenting for roughly two full days once a clerk was on
        // payroll, until this fired. Every OTHER branch in this bot
        // already blurs before falling through to something else; this
        // one is the same discipline, just at the tail of the newest
        // branch.
        if (focused) return [{ type: "screen.blur", payload: {} }];
      }

      // ---- once someone else runs the desk, get out of the way ----
      void lastAppOpened;
      const here = cellOfMm(grid, pos.xMm, pos.zMm);
      if (afterHireCell && scan(world, "staffed").length > 0) {
        if (here.cx === afterHireCell.cx && here.cz === afterHireCell.cz) return [];
        if (focused) return [{ type: "screen.blur", payload: {} }];
        return walkToward(world, afterHireCell);
      }

      // ---- otherwise: stand at the desk ----
      if (here.cx !== deskStandCell.cx || here.cz !== deskStandCell.cz) {
        if (focused) return [{ type: "screen.blur", payload: {} }];
        return walkToward(world, deskStandCell);
      }
      return [];
    },
  };
}
