// Shared multiplayer game logic for docs/PHASE-3.md Scope F's net-*/soak-*
// scenarios: spawns an owned entity on @net/join, tracks it by playerId,
// applies "move" commands, cleans up on @net/leave. Session lifecycle
// enters entirely through the reserved commands the server host submits —
// this system never touches sockets or the auth layer.
export function setup(sim) {
  // Keyed by the full server-assigned actor string ("player:<id>") — the
  // same value InterestPolicy.entitiesFor(world, actor) receives, so the
  // "owner" component stored here must match it exactly, not the bare
  // playerId from @net/join's payload.
  const entityByActor = new Map();
  sim.addSystem((s) => {
    for (const c of s.commands()) {
      if (c.type === "@net/join") {
        const entity = s.spawn();
        s.setComponent(entity, "pos", { x: 0, z: 0 });
        s.setComponent(entity, "owner", c.actor);
        entityByActor.set(c.actor, entity);
        s.emit("joined", { playerId: c.payload.playerId });
      } else if (c.type === "@net/leave") {
        const entity = entityByActor.get(c.actor);
        if (entity !== undefined) {
          s.removeComponent(entity, "pos");
          s.removeComponent(entity, "owner");
          entityByActor.delete(c.actor);
        }
        s.emit("left", { playerId: c.payload.playerId });
      } else if (c.type === "move") {
        const entity = entityByActor.get(c.actor);
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
 *  out for a player spawned at the origin. */
export function setupWithLandmarks(sim, count, spread) {
  setup(sim);
  const rng = new (class {
    constructor(seed) {
      this.s = seed >>> 0;
    }
    next() {
      this.s = (this.s * 1103515245 + 12345) >>> 0;
      return this.s / 4294967296;
    }
  })(12345);
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
