/**
 * The held-document view (docs/PHASE-H1.md, "Held-item inspect"): when the
 * player holds a document (`document.heldBy === PLAYER_ENTITY`), render it
 * as a small textured quad raised toward the camera with its actual field
 * text painted on it. This is the Papers-Please tactile layer — the whole
 * point is that fields must be legible, because reading them against the
 * reservation *is* the gameplay this phase (rules.ts's fraud table).
 *
 * Host-only, presentation-only (invariant 4): reads `document`/`reservation`
 * via `IWorld`, never writes sim state. The text painter itself lives in
 * `./temp-font-painter.ts` — a small canvas-2D painter that stands in for
 * H1b's `@claude-engine/surface-ui/host` `paintScreen` (committed bitmap
 * font). See that file's header comment: H1b should delete it and repaint
 * through the real painter instead of keeping two font paths.
 *
 * A document is not a UI framework — it's a textured quad with a few lines
 * of text, raised and tilted toward the camera each frame; no new
 * abstraction beyond that.
 */
import * as THREE from "three";
import type { EntityId, IWorld } from "@claude-engine/core";
import type { SceneContext } from "@claude-engine/renderer-three";
import type { DocumentComp } from "../sim/components.js";
import { paintDocument, DOC_CANVAS_W, DOC_CANVAS_H, type DocumentPaintLine } from "./temp-font-painter.js";

const DOC_W_M = 0.34;
const DOC_H_M = DOC_W_M * (DOC_CANVAS_H / DOC_CANVAS_W);

/** Local (camera-space) offsets for up to two simultaneously held documents
 *  (ID + reservation slip, per the guest-presenting flow) — fanned out so
 *  both are readable rather than stacked exactly on top of each other. */
const HELD_OFFSETS: readonly THREE.Vector3[] = [
  new THREE.Vector3(0.24, -0.2, -0.55),
  new THREE.Vector3(-0.1, -0.26, -0.5),
];
const HELD_TILT_X = -0.25; // radians; tips the top of the page toward the camera

interface HeldDocEntry {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  /** Dirty-check key: repaint the canvas only when the document's actual
   *  content changed, never unconditionally in the render loop. */
  lastPaintedKey: string;
}

const heldDocs = new Map<EntityId, HeldDocEntry>();

function docTitle(docType: string): string {
  return docType === "id" ? "IDENTIFICATION" : docType === "resSlip" ? "RESERVATION SLIP" : docType.toUpperCase();
}

function fieldsToLines(fields: Record<string, string>): DocumentPaintLine[] {
  return Object.entries(fields).map(([label, value]) => ({ label, value }));
}

function paintKeyFor(doc: DocumentComp): string {
  // Cheap content fingerprint for the dirty check — field values only
  // change when the sim mutates the document (fraud planting is setup-time
  // only per determinism rule 4, so in practice this paints once).
  return `${doc.docType}|${Object.entries(doc.fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
}

function createHeldDocEntry(): HeldDocEntry {
  const canvas = document.createElement("canvas");
  canvas.width = DOC_CANVAS_W;
  canvas.height = DOC_CANVAS_H;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) throw new Error("apps/hotel: 2d canvas context unavailable for held-document painter");
  const texture = new THREE.CanvasTexture(canvas);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const geometry = new THREE.PlaneGeometry(DOC_W_M, DOC_H_M);
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, depthTest: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 999; // always draw on top, like a prop held up to the lens
  mesh.visible = false;

  return { mesh, canvas, ctx2d, texture, lastPaintedKey: "" };
}

const tmpOffset = new THREE.Vector3();

/**
 * Renders every document currently held by `playerEntity` as a raised prop
 * in front of `camera`. Call once per frame from `syncScene`/`onFrame`.
 * Positions/hides via `SceneContext.objectFor` so props are created once
 * and disposed automatically when their document entity despawns (a guest
 * leaving with their documents, or the held document being returned).
 */
export function syncHeldDocuments(ctx: SceneContext, world: IWorld, camera: THREE.Camera, playerEntity: EntityId): void {
  let slot = 0;
  for (const entity of world.entities()) {
    const doc = world.getComponent<DocumentComp>(entity, "document");
    if (!doc || doc.heldBy !== playerEntity) continue;

    const obj = ctx.objectFor(entity, () => {
      const entry = createHeldDocEntry();
      heldDocs.set(entity, entry);
      return entry.mesh;
    });
    const entry = heldDocs.get(entity);
    if (!entry || entry.mesh !== obj) continue; // defensive; should not happen

    const key = paintKeyFor(doc);
    if (key !== entry.lastPaintedKey) {
      paintDocument(entry.ctx2d, docTitle(doc.docType), fieldsToLines(doc.fields));
      entry.texture.needsUpdate = true;
      entry.lastPaintedKey = key;
    }

    const offset = HELD_OFFSETS[slot % HELD_OFFSETS.length]!;
    tmpOffset.copy(offset).applyQuaternion(camera.quaternion);
    entry.mesh.position.copy(camera.position).add(tmpOffset);
    entry.mesh.quaternion.copy(camera.quaternion);
    entry.mesh.rotateX(HELD_TILT_X);
    entry.mesh.visible = true;
    slot++;
  }
}

/** Hide+forget render-only state for documents no longer held/existing.
 *  `SceneContext.objectFor`'s own prune disposes the Three.js mesh when the
 *  entity despawns; this drops this module's side map (`heldDocs`) so it
 *  doesn't grow unbounded, and hides props whose document is still alive
 *  but no longer held (returned via a further `interact`, per the spec). */
export function pruneHeldDocuments(world: IWorld, playerEntity: EntityId): void {
  const stillHeld = new Set<EntityId>();
  for (const entity of world.entities()) {
    const doc = world.getComponent<DocumentComp>(entity, "document");
    if (doc && doc.heldBy === playerEntity) stillHeld.add(entity);
  }
  for (const [entity, entry] of heldDocs) {
    if (!stillHeld.has(entity)) {
      entry.mesh.visible = false;
    }
  }
  // Drop bookkeeping only for entities that no longer exist at all (a
  // returned-but-still-existing document keeps its cached mesh/texture so
  // re-holding it later doesn't repaint from scratch).
  const live = new Set(world.entities());
  for (const entity of heldDocs.keys()) {
    if (!live.has(entity)) heldDocs.delete(entity);
  }
}
