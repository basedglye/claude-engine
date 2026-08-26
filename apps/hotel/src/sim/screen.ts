/**
 * Composes HOTELSOFT '95's shell with the hotel's two H1b apps, and the ONE
 * pure `ScreenWorldView` builder shared by `screenSystem` (game.ts, sim
 * side) and `main.ts` (host side, for `syncScene`'s repaint) — per
 * docs/PHASE-H1.md's screen contract: "two view builders that can disagree
 * is the bug".
 *
 * Pure: this file lives under the `apps/hotel/src/sim` purity root and
 * imports only `@claude-engine/surface-ui`'s pure entry.
 */
import type { IWorld } from "@claude-engine/core";
import { createShell, type ScreenWorldView } from "@claude-engine/surface-ui";
import { reservaApp } from "./reserva-app.js";
import { auditApp } from "./audit-app.js";
import type { DocumentComp, Guest, Hotel, LedgerEntry, Prop, Reservation, RoomUnit } from "./components.js";
import type { ScreenQueueView, ScreenRoomView, ScreenViewData } from "./screen-data.js";

export const hotelShell = createShell([reservaApp, auditApp]);

/**
 * Builds the `ScreenWorldView` for the hotel's terminal, reading only
 * `IWorld` (no `withComponent` — the generic Sim-vs-host boundary; `Sim`
 * itself satisfies `IWorld`, so `screenSystem` calls this with `s` directly
 * and `main.ts` calls it with the same `world: IWorld` it already has).
 * Exactly the 3 `ScreenViewData` keys (`queue`, `rooms`, `ledger`) — see
 * screen-data.ts's header on the <=5 key budget.
 */
export function buildScreenWorldView(world: IWorld): ScreenWorldView {
  let hotel: Hotel | undefined;
  const rooms: ScreenRoomView[] = [];
  const docsByOwner = new Map<number, Record<string, Record<string, string>>>();
  const reservationByGuest = new Map<number, { reservationEntity: number; res: Reservation }>();
  let presentingGuestEntity: number | undefined;

  const ledgerEntries: LedgerEntry[] = [];
  const brokenRoomEntities = new Set<number>();

  // ONE sweep over entities, not two (docs/PHASE-H2.md §12 item 1). The
  // second sweep existed only to total the ledger, which needs `day` from
  // the hotel singleton — so the entries are collected here and filtered
  // by day below, once `hotel` is known.
  //
  // Deliberately still `IWorld`-only, NOT the sim-side tick context the
  // spec suggests: this is the ONE view builder that `screenSystem` and
  // `main.ts`'s repaint share, and H1b's screen contract exists because two
  // view builders that can disagree is the bug. The host has no tick
  // context; giving the sim a second, faster path would recreate exactly
  // that hazard for a scan that runs at most once per focused tick.
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

  let revenueMinor = 0;
  let expenseMinor = 0;
  const day = hotel ? hotel.day : 0;
  for (const entry of ledgerEntries) {
    if (entry.day !== day) continue;
    if (entry.creditAccount === "revenue:rooms") revenueMinor += entry.amountMinor;
    if (entry.debitAccount.startsWith("expense:")) expenseMinor += entry.amountMinor;
  }

  const data: ScreenViewData = {
    queue,
    rooms: sellableRooms,
    ledger: { day, revenueMinor, expenseMinor, closingCashMinor: hotel ? hotel.cash : 0 },
  };
  return { tick: world.tick, data: data as unknown as Record<string, unknown> };
}
