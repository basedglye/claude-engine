import * as THREE from "three";
import type { TerrainData } from "../terrain.js";
import type { MeshData } from "../mesh.js";

/** Plain typed-array MeshData -> an indexed THREE.BufferGeometry. */
export function toBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.colors) geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  return geometry;
}

/** TerrainData heightmap -> a ground-plane THREE.BufferGeometry (XZ plane,
 *  Y = height, centered at the origin, size x size world units). */
export function terrainToGeometry(terrain: TerrainData): THREE.BufferGeometry {
  const { size, resolution, heights } = terrain;
  const geometry = new THREE.BufferGeometry();
  const vertCount = Math.max(0, resolution) * Math.max(0, resolution);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const half = size / 2;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const i = z * resolution + x;
      const u = resolution <= 1 ? 0 : x / (resolution - 1);
      const v = resolution <= 1 ? 0 : z / (resolution - 1);
      const worldX = u * size - half;
      const worldZ = v * size - half;
      const h = heights[i] ?? 0;
      positions[i * 3] = worldX;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = worldZ;
      uvs[i * 2] = u;
      uvs[i * 2 + 1] = v;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < resolution - 1; z++) {
    for (let x = 0; x < resolution - 1; x++) {
      const i0 = z * resolution + x;
      const i1 = z * resolution + x + 1;
      const i2 = (z + 1) * resolution + x;
      const i3 = (z + 1) * resolution + x + 1;
      indices.push(i0, i2, i1, i1, i2, i3);
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
