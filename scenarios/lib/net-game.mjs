// Shared multiplayer game logic for docs/PHASE-3.md Scope F's net-*/soak-*
// scenarios: spawns an owned entity on @net/join, applies "move" commands,
// cleans up on @net/leave. Session lifecycle enters entirely through the
// reserved commands the server host submits — this system never touches
// sockets or the auth layer.
//
// The actor->entity lookup is derived from the "owner" component on every
// use (via withComponent), NOT cached in a setup-closure Map. A closure Map
// is exactly the kind of cross-tick state Sim.restore() cannot rebuild —
// restore() replaces component stores, but a fresh setup() call runs before
// restore() and would populate a NEW, empty Map that never learns about
// entities the snapshot already contains. Any actor who joined before the
// last snapshot would then have a real entity in the restored components
// but no map entry, silently dropping every replayed command for them.
// Deriving the lookup from components instead means restore() rebuilding
// component state is *automatically* correct — there is no separate index
// to go stale. See references/core-api.md's restore section and
// references/net-api.md's multiplayer workflow step 1.
function findEntityByOwner(s, actor) {
  for (const [entity, owner] of s.withComponent("owner")) {
    if (owner === actor) return entity;
  }
  return undefined;
}

export function setup(sim) {
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        // Idempotent per actor: a superseded connection's leave and the new
        // connection's join can arrive close together; never spawn a second
        // entity for an actor that already has one.
        if (findEntityByOwner(s, c.actor) !== undefined) continue;
        const entity = s.spawn();
        s.setComponent(entity, "pos", { x: 0, z: 0 });
        s.setComponent(entity, "owner", c.actor);
        s.emit("joined", { playerId: c.payload.playerId });
      } else if (c.type === "@net/leave") {
        const entity = findEntityByOwner(s, c.actor);
        if (entity !== undefined) {
          s.removeComponent(entity, "pos");
          s.removeComponent(entity, "owner");
        }
        s.emit("left", { playerId: c.payload.playerId });
      } else if (c.type === "move") {
        const entity = findEntityByOwner(s, c.actor);
        if (entity === undefined) continue;
        const pos = s.getComponent(entity, "pos");
        if (!pos) continue;
        pos.x += c.payload.dx;
        pos.z += c.payload.dz;
        s.emit("moved", { actor: c.actor, x: pos.x, z: pos.z });
      }
    }
  });
}

/** Adds static, unowned "landmark" entities scattered across a wide area —
 *  positional-only, so a radiusInterest policy has something real to filter
 *  out for a player spawned at the origin. Setup-time only, drawn from a
 *  forkRng stream so it's captured/restored the same as any other sim-held
 *  randomness (docs/PHASE-3.md Scope A). */
export function setupWithLandmarks(sim, count, spread) {
  setup(sim);
  const rng = sim.forkRng("landmarks");
  for (let i = 0; i < count; i++) {
    const entity = sim.spawn();
    const angle = rng.next() * Math.PI * 2;
    const distance = spread * (0.5 + rng.next() * 0.5); // always far (outside a small-radius interest)
    sim.setComponent(entity, "pos", { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance });
    sim.setComponent(entity, "landmark", true);
  }
}

export const moveRule = {
  validate: (p) => typeof p?.dx === "number" && typeof p?.dz === "number",
  maxPerTick: 1,
  maxPerSecond: 30,
};
