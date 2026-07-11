import type { EntityId, IWorld } from "@claude-engine/core";

export interface InterestPolicy {
  entitiesFor(world: IWorld, actor: string): Iterable<EntityId>;
}

export function allEntities(): InterestPolicy {
  return {
    entitiesFor(world: IWorld): Iterable<EntityId> {
      return world.entities();
    },
  };
}

/** Each actor sees entities within `radius` of any entity it owns
 *  (ownerComponent's value === the owning actor string). */
export function radiusInterest(opts: {
  positionComponent: string;
  ownerComponent: string;
  radius: number;
}): InterestPolicy {
  const { positionComponent, ownerComponent, radius } = opts;
  const radiusSq = radius * radius;
  return {
    *entitiesFor(world: IWorld, actor: string): Iterable<EntityId> {
      const ownedPositions: { x: number; z: number }[] = [];
      for (const id of world.entities()) {
        if (world.getComponent<string>(id, ownerComponent) === actor) {
          const pos = world.getComponent<{ x: number; z: number }>(id, positionComponent);
          if (pos) ownedPositions.push(pos);
        }
      }
      if (ownedPositions.length === 0) return;
      for (const id of world.entities()) {
        const pos = world.getComponent<{ x: number; z: number }>(id, positionComponent);
        if (!pos) continue;
        for (const owned of ownedPositions) {
          const dx = pos.x - owned.x;
          const dz = pos.z - owned.z;
          if (dx * dx + dz * dz <= radiusSq) {
            yield id;
            break;
          }
        }
      }
    },
  };
}
