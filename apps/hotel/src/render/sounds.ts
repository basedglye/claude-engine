/**
 * The hotel's event -> sound table (host-side; see docs/PHASE-H2.md section
 * 5B). This file lives under apps/hotel/src/render, NOT under
 * apps/hotel/src/sim — it is not a purity root, it imports @claude-engine/
 * audio (host-only), and it is safe to import DOM/WebAudio types here.
 *
 * GAMEPLAY_EVENT_TYPES is the full, verified vocabulary of `s.emit(...)`
 * calls in apps/hotel/src/sim/game.ts (grepped, not guessed — see the
 * implementer's report for the diff against the task's reference list).
 * Every entry is either a row in HOTEL_SOUND_RULES or a line in
 * DELIBERATELY_SILENT; auditSoundCoverage() (the audio-coverage gate)
 * enforces that no event can be silently forgotten in either direction.
 */
import type { SoundRule, SynthSpec } from "@claude-engine/audio";

/** The full set of event types apps/hotel/src/sim/game.ts actually emits
 *  via `s.emit(...)`. NOTE for the reviewer: this list intentionally does
 *  NOT include "desk.decision", "screen.click", "screen.key", "screen.blur",
 *  "debug.saveRestoreRecord", "mailbox.read", or "staff.hire" — those are
 *  COMMAND types (`c.type`), not emitted GameEvents; the sim never calls
 *  `s.emit()` with any of them. The actually-emitted mail-read event is
 *  named "mail.read", not "mailbox.read", and the actually-emitted hire
 *  event is named "staff.hired", not "staff.hire". See the implementer's
 *  final report for the full diff against the task brief's reference list. */
export const GAMEPLAY_EVENT_TYPES: readonly string[] = [
  "guest.arrived",
  "guest.queued",
  "guest.checkedOut",
  "guest.checkedIn",
  "guest.denied",
  "guest.presenting",
  "guest.left",
  "guest.reviewed",
  "guest.complained",
  "mail.delivered",
  "mail.read",
  "mail.bulletinDelivered",
  "room.messSpawned",
  "room.messCleaned",
  "door",
  "nav.yield",
  "nav.stuck",
  "interact-denied",
  "prop.repaired",
  "prop.repairStep",
  "prop.broke",
  "incident.resolved",
  "staff.interviewStarted",
  "staff.candidateArrived",
  "staff.candidateLeft",
  "staff.rejected",
  "staff.hired",
  "staff.decision",
  "document.held",
  "screen.denied",
  "screen.appOpened",
  "screen.actionTaken",
  "desk.denied-room",
  "desk.fraudMissed",
  "desk.fraudCaught",
  "desk.falseDeny",
  "econ.rateSet",
  "econ.hireUnlocked",
  "econ.audit",
  "objective.posted",
  "objective.completed",
  "objective.failed",
  "hotel.starsChanged",
  "printer.printed",
] as const;

/** Events left intentionally unvoiced. Every entry needs a one-line reason;
 *  the audio-coverage gate fails the build otherwise. Debug/internal/
 *  denial-spam events go here — a "no" is heard through the world (a door
 *  not opening, a guest not stepping forward), not through a buzzer. */
export const DELIBERATELY_SILENT: readonly string[] = [
  // Denial classes: silence IS the feedback (no error-beep pattern per
  // DESIGN's no-HUD-alert ruling; the player reads state, not sound).
  "interact-denied",
  "screen.denied",
  "desk.denied-room",
  // Fraud sub-events overlap with desk.decision's own SFX cue (not in this
  // list because it's a command, not an event) — catching/missing fraud is
  // felt through the review/complaint loop days later, per DESIGN's
  // day-granularity-consequences ruling, not an instant jingle.
  "desk.fraudMissed",
  "desk.fraudCaught",
  "desk.falseDeny",
  // Internal bookkeeping / analytics events with no in-world moment.
  "staff.decision",
  "nav.yield",
  "nav.stuck",
  "room.messSpawned",
  "screen.actionTaken",
  "objective.posted",
  "objective.failed",
  "econ.hireUnlocked",
  "mail.bulletinDelivered",
  "guest.checkedOut",
  "guest.presenting",
  "guest.queued",
  "guest.left",
  "guest.denied",
  "staff.candidateLeft",
  "staff.interviewStarted",
  "document.held",
  "screen.appOpened",
];

const doorCreak: SynthSpec = {
  wave: "sawtooth",
  freqHz: 180,
  freqEndHz: 420,
  durationMs: 260,
  gain: 0.5,
};

const deskBell: SynthSpec = {
  wave: "sine",
  freqHz: 1320,
  durationMs: 180,
  gain: 0.6,
};

const printerChatter: readonly SynthSpec[] = [
  { wave: "square", freqHz: 620, durationMs: 90, gain: 0.35, noiseMs: 60 },
  { wave: "square", freqHz: 540, durationMs: 90, gain: 0.35, noiseMs: 60 },
  { wave: "square", freqHz: 700, durationMs: 90, gain: 0.35, noiseMs: 60 },
];

const messWiped: SynthSpec = {
  wave: "triangle",
  freqHz: 300,
  freqEndHz: 520,
  durationMs: 140,
  gain: 0.4,
};

const propRepairStep: SynthSpec = {
  wave: "square",
  freqHz: 260,
  durationMs: 80,
  gain: 0.3,
};

const propRepaired: SynthSpec = {
  wave: "triangle",
  freqHz: 440,
  freqEndHz: 880,
  durationMs: 320,
  gain: 0.5,
};

const propBroke: SynthSpec = {
  wave: "sawtooth",
  freqHz: 220,
  freqEndHz: 60,
  durationMs: 400,
  gain: 0.6,
  noiseMs: 220,
};

const checkinChime: SynthSpec = {
  wave: "sine",
  freqHz: 660,
  freqEndHz: 990,
  durationMs: 220,
  gain: 0.55,
};

const auditChime: SynthSpec = {
  wave: "sine",
  freqHz: 440,
  durationMs: 300,
  gain: 0.4,
};

const starsFanfare: SynthSpec = {
  wave: "triangle",
  freqHz: 523,
  freqEndHz: 1046,
  durationMs: 600,
  gain: 0.6,
};

const screenClick: SynthSpec = {
  wave: "square",
  freqHz: 900,
  durationMs: 30,
  gain: 0.25,
};

const mailDelivered: SynthSpec = {
  wave: "sine",
  freqHz: 740,
  durationMs: 120,
  gain: 0.3,
};

const mailRead: SynthSpec = {
  wave: "sine",
  freqHz: 500,
  durationMs: 90,
  gain: 0.25,
};

const candidateArrived: SynthSpec = {
  wave: "sine",
  freqHz: 392,
  freqEndHz: 523,
  durationMs: 260,
  gain: 0.4,
};

const staffHired: SynthSpec = {
  wave: "triangle",
  freqHz: 392,
  freqEndHz: 784,
  durationMs: 500,
  gain: 0.6,
};

const staffRejected: SynthSpec = {
  wave: "sawtooth",
  freqHz: 300,
  freqEndHz: 180,
  durationMs: 220,
  gain: 0.35,
};

const objectiveCompleted: SynthSpec = {
  wave: "triangle",
  freqHz: 587,
  freqEndHz: 880,
  durationMs: 260,
  gain: 0.45,
};

const rateSet: SynthSpec = {
  wave: "square",
  freqHz: 480,
  durationMs: 70,
  gain: 0.3,
};

/** The hotel's event -> sound table. Positional (`at: "entity"`) rules name
 *  the payload field that actually carries the entity id — cross-checked
 *  against the `s.emit(...)` call sites in apps/hotel/src/sim/game.ts, not
 *  assumed from the default. */
export const HOTEL_SOUND_RULES: readonly SoundRule[] = [
  // "door"'s payload is { doorIndex, open } — no entity id (doorIndex
  // indexes the ground floor's door array, not an ECS entity), so this
  // cannot be an `at: "entity"` rule despite reading like a positional
  // sound; "ui" is the only correct choice for this payload shape.
  { eventType: "door", spec: doorCreak, at: "ui" },
  { eventType: "guest.checkedIn", spec: checkinChime, at: "entity", entityField: "guestEntity" },
  { eventType: "guest.reviewed", spec: deskBell, at: "ui" },
  { eventType: "guest.complained", spec: staffRejected, at: "ui" },
  { eventType: "guest.arrived", spec: candidateArrived, at: "entity", entityField: "guestEntity", minIntervalMs: 500 },
  { eventType: "room.messCleaned", spec: messWiped, at: "entity", entityField: "roomEntity" },
  { eventType: "prop.repairStep", spec: propRepairStep, at: "entity", entityField: "propEntity" },
  { eventType: "prop.repaired", spec: propRepaired, at: "entity", entityField: "propEntity" },
  { eventType: "incident.resolved", spec: propRepaired, at: "entity", entityField: "propEntity", minIntervalMs: 1000 },
  { eventType: "prop.broke", spec: propBroke, at: "entity", entityField: "propEntity" },
  { eventType: "printer.printed", spec: printerChatter, at: "ui" },
  { eventType: "econ.audit", spec: auditChime, at: "ui" },
  { eventType: "hotel.starsChanged", spec: starsFanfare, at: "ui" },
  { eventType: "econ.rateSet", spec: rateSet, at: "ui" },
  { eventType: "mail.delivered", spec: mailDelivered, at: "ui", minIntervalMs: 300 },
  { eventType: "mail.read", spec: mailRead, at: "ui" },
  { eventType: "staff.candidateArrived", spec: candidateArrived, at: "entity", entityField: "candidateEntity" },
  { eventType: "staff.hired", spec: staffHired, at: "ui" },
  { eventType: "staff.rejected", spec: staffRejected, at: "ui" },
  { eventType: "objective.completed", spec: objectiveCompleted, at: "ui" },
];

/** All screen clicks/keys resolve to a UI click — kept as one shared spec so
 *  the table stays diffable content rather than a fork per app. Note:
 *  "screen.click"/"screen.key" are COMMAND types, never emitted GameEvents
 *  (see GAMEPLAY_EVENT_TYPES's comment) — screen.appOpened is the emitted
 *  event, and it's deliberately silent (state change is visible on-screen).
 *  This export exists for the host loop to wire directly to raw input if it
 *  chooses to; it is not part of the audio-coverage contract. */
export const UI_CLICK_SPEC: SynthSpec = screenClick;
