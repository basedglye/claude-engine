/**
 * Composes HOTELSOFT '95's shell with the hotel's six apps, and the ONE
 * pure `ScreenWorldView` builder shared by `screenSystem` (game.ts, sim
 * side) and `main.ts` (host side, for `syncScene`'s repaint) — per
 * docs/PHASE-H1.md's screen contract: "two view builders that can disagree
 * is the bug".
 *
 * Pure: this file lives under the `apps/hotel/src/sim` purity root and
 * imports only `@claude-engine/surface-ui`'s pure entry.
 *
 * The registry stops at six (docs/PHASE-H2.md non-goals): RESERVA, AUDIT,
 * LEDGER, PRICER, MAILBOX, STAFF. PURCHASE / CCTV / BLUEPRINT / STREETVIEW
 * are later phases. `HOTEL_APPS` is exported so the composed-shell overflow
 * gate DERIVES its app list from the registry instead of hardcoding one —
 * app seven can then never silently skip the gate (H1b pattern obligation).
 */
import type { IWorld } from "@claude-engine/core";
import { createShell, type ScreenAppDef, type ScreenWorldView } from "@claude-engine/surface-ui";
import { reservaApp } from "./reserva-app.js";
import { auditApp } from "./audit-app.js";
import { ledgerApp } from "./ledger-app.js";
import { pricerApp } from "./pricer-app.js";
import { mailboxApp } from "./mailbox-app.js";
import { staffApp } from "./staff-app.js";
import { hash32 } from "./nav.js";
import {
  MIN_RATE_MINOR,
  RATE_STEP_MINOR,
  HIRE_THRESHOLD_MINOR,
  MAX_HOTEL_TIER,
  RENOVATE_COST_MINOR,
  RENOVATE_STAR_REQ,
  maxRateForHotelTier,
} from "./economy.js";
import { DEMAND_BUCKETS } from "./pricer-app.js";
import type {
  Candidate,
  DocumentComp,
  Guest,
  Hotel,
  LedgerEntry,
  Mail,
  Objective,
  Person,
  Prop,
  Reservation,
  RoomUnit,
  Staffed,
} from "./components.js";
import type {
  ScreenCandidateView,
  ScreenLedgerDayView,
  ScreenMailView,
  ScreenObjectiveView,
  ScreenQueueView,
  ScreenRoomView,
  ScreenStaffMemberView,
  ScreenViewData,
} from "./screen-data.js";

/** The registered apps, in taskbar order. Exported so tests and gates
 *  enumerate the registry rather than a duplicate list. */
export const HOTEL_APPS: readonly ScreenAppDef<never>[] = [
  reservaApp,
  auditApp,
  ledgerApp,
  pricerApp,
  mailboxApp,
  staffApp,
] as unknown as readonly ScreenAppDef<never>[];

export const hotelShell = createShell([reservaApp, auditApp, ledgerApp, pricerApp, mailboxApp, staffApp]);

/**
 * PRICER's "deliberately fuzzy demand graph", as display data.
 *
 * A stateless hash of (day, tier) quantised into DEMAND_BUCKETS coarse
 * buckets — never an Rng draw (looking at a screen must not perturb a
 * stream) and never stored in a component (it is presentation). Recomputed
 * identically on every repaint and in every replay, which is what makes it
 * a graph a player can plan against rather than a flicker.
 */
function demandBucket(day: number, tier: number): number {
  return hash32(((day << 8) ^ tier) >>> 0) % DEMAND_BUCKETS;
}

/**
 * Builds the `ScreenWorldView` for the hotel's terminal, reading only
 * `IWorld` (no `withComponent` — the generic Sim-vs-host boundary; `Sim`
 * itself satisfies `IWorld`, so `screenSystem` calls this with `s` directly
 * and `main.ts` calls it with the same `world: IWorld` it already has).
 *
 * ONE sweep over entities (docs/PHASE-H2.md §12 item 1); everything that
 * needs a second look works from arrays collected during it.
 */
export function buildScreenWorldView(world: IWorld): ScreenWorldView {
  let hotel: Hotel | undefined;
  const rooms: ScreenRoomView[] = [];
  const docsByOwner = new Map<number, Record<string, Record<string, string>>>();
  const reservationByGuest = new Map<number, { reservationEntity: number; res: Reservation }>();
  const ledgerEntries: LedgerEntry[] = [];
  const brokenRoomEntities = new Set<number>();
  const mail: ScreenMailView[] = [];
  const objectives: { entity: number; objective: Objective }[] = [];
  const candidates: { entity: number; candidate: Candidate }[] = [];
  const hired: { entity: number; staffed: Staffed }[] = [];
  const personByEntity = new Map<number, Person>();
  let presentingGuestEntity: number | undefined;

  for (const entity of world.entities()) {
    const h = world.getComponent<Hotel>(entity, "hotel");
    if (h) hotel = h;

    const entry = world.getComponent<LedgerEntry>(entity, "ledgerEntry");
    if (entry) ledgerEntries.push(entry);

    const room = world.getComponent<RoomUnit>(entity, "roomUnit");
    // Vacant AND wiped. A room with a broken prop is filtered after the
    // sweep (props are found in this same pass). RESERVA showing a room it
    // cannot actually sell would be a lie the desk then refuses — the
    // screen's list and `applyDeskDecision`'s `roomReady` check are the
    // same eligibility rule, seen from two sides.
    if (room && room.occupantEntity === 0 && room.messCount === 0) {
      rooms.push({ roomEntity: entity, roomId: room.roomId, tier: room.tier });
    }

    const prop = world.getComponent<Prop>(entity, "prop");
    if (prop && prop.broken) brokenRoomEntities.add(prop.roomEntity);

    const doc = world.getComponent<DocumentComp>(entity, "document");
    if (doc) {
      const bucket = docsByOwner.get(doc.ownerEntity) ?? {};
      bucket[doc.docType] = doc.fields;
      docsByOwner.set(doc.ownerEntity, bucket);
    }

    const res = world.getComponent<Reservation>(entity, "reservation");
    if (res && !res.decided) reservationByGuest.set(res.guestEntity, { reservationEntity: entity, res });

    const guest = world.getComponent<Guest>(entity, "guest");
    if (guest && guest.state === "presenting" && presentingGuestEntity === undefined) {
      presentingGuestEntity = entity;
    }

    const mailComp = world.getComponent<Mail>(entity, "mail");
    if (mailComp) {
      mail.push({
        mailEntity: entity,
        day: mailComp.day,
        kind: mailComp.kind,
        subjectKey: mailComp.subjectKey,
        fields: mailComp.fields,
        read: mailComp.read,
      });
    }

    const objective = world.getComponent<Objective>(entity, "objective");
    if (objective) objectives.push({ entity, objective });

    const candidate = world.getComponent<Candidate>(entity, "candidate");
    if (candidate) candidates.push({ entity, candidate });

    const staffed = world.getComponent<Staffed>(entity, "staffed");
    if (staffed) hired.push({ entity, staffed });

    const person = world.getComponent<Person>(entity, "person");
    if (person) personByEntity.set(entity, person);
  }

  const sellableRooms = rooms.filter((r) => !brokenRoomEntities.has(r.roomEntity));
  sellableRooms.sort((a, b) => a.roomId - b.roomId);

  let queue: ScreenQueueView | null = null;
  if (presentingGuestEntity !== undefined) {
    const found = reservationByGuest.get(presentingGuestEntity);
    if (found) {
      queue = {
        reservationEntity: found.reservationEntity,
        guestEntity: presentingGuestEntity,
        docFields: docsByOwner.get(presentingGuestEntity) ?? {},
        resFields: found.res.fields,
      };
    }
  }

  const day = hotel ? hotel.day : 0;
  let revenueMinor = 0;
  let expenseMinor = 0;
  const byDay = new Map<number, { revenueMinor: number; expenseMinor: number }>();
  for (const entry of ledgerEntries) {
    const isRevenue = entry.creditAccount.startsWith("revenue:");
    const isExpense = entry.debitAccount.startsWith("expense:");
    if (entry.day === day) {
      if (isRevenue) revenueMinor += entry.amountMinor;
      if (isExpense) expenseMinor += entry.amountMinor;
    }
    if (entry.day >= day) continue; // closed days only, below
    const bucket = byDay.get(entry.day) ?? { revenueMinor: 0, expenseMinor: 0 };
    if (isRevenue) bucket.revenueMinor += entry.amountMinor;
    if (isExpense) bucket.expenseMinor += entry.amountMinor;
    byDay.set(entry.day, bucket);
  }
  const ledgerDays: ScreenLedgerDayView[] = [...byDay.keys()]
    .sort((a, b) => a - b)
    .map((d) => ({ day: d, revenueMinor: byDay.get(d)!.revenueMinor, expenseMinor: byDay.get(d)!.expenseMinor }));

  const todaysObjectives: ScreenObjectiveView[] = objectives
    .filter((o) => o.objective.day === day)
    .sort((a, b) => a.entity - b.entity)
    .map(({ objective }) => ({
      day: objective.day,
      kind: objective.kind,
      target: objective.target,
      progress: objective.progress,
      done: objective.done,
      rewardMinor: objective.rewardMinor,
    }));

  // Newest first; entity id is the tiebreak within a day, and it is a
  // monotonic spawn counter, so this is a stable "most recent first".
  mail.sort((a, b) => (b.day - a.day) || (b.mailEntity - a.mailEntity));

  const rateByTier = hotel ? hotel.rateByTier : {};
  const demandBuckets = Object.keys(rateByTier)
    .map((k) => Number.parseInt(k, 10))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
    .map((tier) => ({ tier, bucket: demandBucket(day, tier) }));

  const candidateViews: ScreenCandidateView[] = candidates
    .filter(({ candidate }) => candidate.state === "waiting" || candidate.state === "interviewing")
    .sort((a, b) => a.entity - b.entity)
    .map(({ entity, candidate }) => ({
      candidateEntity: entity,
      name: personByEntity.get(entity)?.name ?? `Applicant ${entity}`,
      wageAsk: candidate.wageAsk,
      skillPermille: candidate.skillPermille,
      quirk: candidate.quirk,
      state: candidate.state,
    }));

  const hiredViews: ScreenStaffMemberView[] = hired
    .sort((a, b) => a.entity - b.entity)
    .map(({ entity, staffed }) => ({
      staffEntity: entity,
      name: personByEntity.get(entity)?.name ?? `Clerk ${entity}`,
      job: staffed.job,
      wage: staffed.wage,
      skillPermille: staffed.skillPermille,
      quirk: staffed.quirk,
    }));

  const cashMinor = hotel ? hotel.cash : 0;
  const hireUnlocked = hotel ? hotel.hireUnlocked : false;
  const hotelTier = hotel ? hotel.tier : 0;
  const hotelStars = hotel ? hotel.stars : 1;
  const nextHotelTier = hotelTier < MAX_HOTEL_TIER ? hotelTier + 1 : hotelTier;
  const renovateCostMinor = hotelTier < MAX_HOTEL_TIER ? RENOVATE_COST_MINOR[nextHotelTier] ?? 0 : 0;
  const renovateStarReq = hotelTier < MAX_HOTEL_TIER ? RENOVATE_STAR_REQ[nextHotelTier] ?? 0 : 0;
  const renovateAvailable =
    hotelTier < MAX_HOTEL_TIER && hotelStars >= renovateStarReq && cashMinor >= renovateCostMinor;

  const data: ScreenViewData = {
    queue,
    rooms: sellableRooms,
    stars: hotel ? hotel.stars : 1,
    ledger: {
      day,
      revenueMinor,
      expenseMinor,
      closingCashMinor: cashMinor,
      cashMinor,
      hireUnlocked,
      hireThresholdMinor: HIRE_THRESHOLD_MINOR,
      hotelTier,
      renovateCostMinor,
      renovateStarReq,
      renovateAvailable,
    },
    ledgerDays,
    objectives: todaysObjectives,
    pricing: {
      rateByTier,
      minRateMinor: MIN_RATE_MINOR,
      maxRateMinor: maxRateForHotelTier(hotelTier),
      stepMinor: RATE_STEP_MINOR,
      demandBuckets,
    },
    mail,
    staff: {
      candidates: candidateViews,
      hired: hiredViews,
      cashMinor,
      hireUnlocked,
      hireThresholdMinor: HIRE_THRESHOLD_MINOR,
    },
  };
  return { tick: world.tick, data: data as unknown as Record<string, unknown> };
}
