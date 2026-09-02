/**
 * Host-side asset loading for the "real hotel" look: PBR texture sets,
 * glTF models, and an HDR environment, all CC0 and fetched into
 * `apps/hotel/public/assets/` by `apps/hotel/scripts/fetch-assets.mjs`
 * (the payload is gitignored; `apps/hotel/assets.manifest.json` is the
 * committed contract listing what the fetch produces).
 *
 * Everything here is presentation-only and DEGRADES GRACEFULLY: a missing
 * manifest, texture or model resolves to `undefined` (never throws, never
 * rejects) so a fresh clone that has not run the fetch — and the harness's
 * headless browser gates — still get the flat-colour build that H0–H2a
 * shipped. Callers must always keep a fallback path.
 *
 * `makePbrMaterial` is the key primitive for scene code that builds
 * synchronously: it returns a usable flat-colour material immediately and
 * upgrades that SAME material object in place when the texture set lands.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { HIGH_QUALITY } from "./quality.js";

export const ASSET_ROOT = "/assets";
export const MANIFEST_URL = `${ASSET_ROOT}/manifest.json`;

// -- manifest ---------------------------------------------------------------

export interface TextureEntry {
  /** Directory under /assets/textures/. Files inside are canonical:
   *  color.jpg (required), normal.jpg, roughness.jpg, ao.jpg (optional). */
  dir: string;
  /** Physical size of one texture tile, in metres (2 == the image covers a
   *  2m x 2m patch before repeating). */
  tileM: number;
  source: string;
  license: string;
}

export interface ModelEntry {
  /** Path under /assets/ to a .glb or .gltf. */
  path: string;
  source: string;
  license: string;
  /** Optional authored footprint hint (metres) when the model's own scale
   *  is not 1 unit == 1 metre; decor code fits the bounding box to this. */
  footprintM?: { w: number; d: number; h: number };
  /** Animation clip names for characters, when present. */
  clips?: { idle?: string; walk?: string };
}

export interface AssetManifest {
  textures: Record<string, TextureEntry>;
  models: Record<string, ModelEntry>;
  characters: Record<string, ModelEntry>;
  env?: { path: string; source: string; license: string };
}

let manifestPromise: Promise<AssetManifest | undefined> | undefined;

export function loadManifest(): Promise<AssetManifest | undefined> {
  // Low quality (software GL / harness): behave exactly as if the pack were
  // never fetched -- every caller keeps its procedural fallback.
  if (!HIGH_QUALITY) {
    // Not "missing": the pack may well be installed; this tier just does
    // not use it, so the HUD must not tell the player to fetch it.
    assetStatus.manifest = "ok";
    return Promise.resolve(undefined);
  }
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((r) => (r.ok ? (r.json() as Promise<AssetManifest>) : undefined))
      .catch(() => undefined);
  }
  return manifestPromise;
}

/** Reports what loaded and what fell back — read by the HUD's loading
 *  line and useful when driving the build by hand. */
export const assetStatus = {
  manifest: "pending" as "pending" | "ok" | "missing",
  texturesOk: 0,
  texturesMissing: 0,
  modelsOk: 0,
  modelsMissing: 0,
  pending: 0,
};

// -- textures ----------------------------------------------------------------

const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, Promise<THREE.Texture | undefined>>();

function loadTextureFile(url: string, colorSpace: THREE.ColorSpace): Promise<THREE.Texture | undefined> {
  let p = textureCache.get(url);
  if (!p) {
    p = new Promise<THREE.Texture | undefined>((resolve) => {
      textureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = colorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        () => resolve(undefined)
      );
    });
    textureCache.set(url, p);
  }
  return p;
}

export interface PbrTextureSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  aoMap?: THREE.Texture;
  tileM: number;
}

/** Loads the canonical texture set for a manifest texture name. Resolves
 *  `undefined` if the manifest or the colour map is missing. The returned
 *  textures are SHARED (cached) — callers set `repeat` on a clone if they
 *  need a different tiling than `tileM` implies (see `makePbrMaterial`). */
export async function loadPbrTextures(name: string): Promise<PbrTextureSet | undefined> {
  const manifest = await loadManifest();
  assetStatus.manifest = manifest ? "ok" : "missing";
  const entry = manifest?.textures[name];
  if (!entry) {
    assetStatus.texturesMissing++;
    return undefined;
  }
  const base = `${ASSET_ROOT}/textures/${entry.dir}`;
  const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
    loadTextureFile(`${base}/color.jpg`, THREE.SRGBColorSpace),
    loadTextureFile(`${base}/normal.jpg`, THREE.NoColorSpace),
    loadTextureFile(`${base}/roughness.jpg`, THREE.NoColorSpace),
    loadTextureFile(`${base}/ao.jpg`, THREE.NoColorSpace),
  ]);
  if (!map) {
    assetStatus.texturesMissing++;
    return undefined;
  }
  assetStatus.texturesOk++;
  const set: PbrTextureSet = { map, tileM: entry.tileM };
  if (normalMap) set.normalMap = normalMap;
  if (roughnessMap) set.roughnessMap = roughnessMap;
  if (aoMap) set.aoMap = aoMap;
  return set;
}

export interface PbrMaterialOptions {
  /** Flat colour used until (or instead of) the texture set. */
  fallbackColor: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  /** Override the manifest's tile size (metres per repeat). */
  tileM?: number;
  /** Scale applied to the normal map, default 1. */
  normalScale?: number;
  side?: THREE.Side;
}

/**
 * Returns a MeshStandardMaterial immediately (flat `fallbackColor`) and
 * upgrades it in place when the named texture set loads. Geometry using
 * it must carry planar UVs IN METRES (u = world X or Z, v = world Y or Z):
 * the tiling is then `1 / tileM` so a 2m marble tile is 2m in the world.
 */
export function makePbrMaterial(name: string, opts: PbrMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: opts.fallbackColor,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0,
    side: opts.side ?? THREE.FrontSide,
  });
  assetStatus.pending++;
  void loadPbrTextures(name).then((set) => {
    assetStatus.pending--;
    if (!set) return;
    const tileM = opts.tileM ?? set.tileM;
    const repeat = 1 / tileM;
    const tile = (t: THREE.Texture): THREE.Texture => {
      const c = t.clone();
      c.repeat.set(repeat, repeat);
      c.needsUpdate = true;
      return c;
    };
    material.map = tile(set.map);
    // Textured surfaces read their albedo from the map; a tinted fallback
    // colour would otherwise multiply into it and muddy everything.
    material.color.set(0xffffff);
    if (set.normalMap) {
      material.normalMap = tile(set.normalMap);
      const s = opts.normalScale ?? 1;
      material.normalScale.set(s, s);
    }
    if (set.roughnessMap) {
      material.roughnessMap = tile(set.roughnessMap);
      material.roughness = 1;
    }
    if (set.aoMap) material.aoMap = tile(set.aoMap);
    material.needsUpdate = true;
  });
  return material;
}

// -- models -------------------------------------------------------------------

const gltfLoader = new GLTFLoader();
const modelCache = new Map<string, Promise<GLTF | undefined>>();

function loadGltf(path: string): Promise<GLTF | undefined> {
  let p = modelCache.get(path);
  if (!p) {
    p = new Promise<GLTF | undefined>((resolve) => {
      gltfLoader.load(
        path.startsWith("/") ? path : `${ASSET_ROOT}/${path}`,
        (gltf) => resolve(gltf),
        undefined,
        () => resolve(undefined)
      );
    });
    modelCache.set(path, p);
  }
  return p;
}

export interface LoadedModel {
  /** A fresh, independently transformable instance (SkeletonUtils.clone,
   *  so skinned characters get their own bones). Materials/geometry are
   *  shared with the cache — do not dispose them per instance. */
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  entry: ModelEntry;
}

async function loadModelFrom(table: "models" | "characters", name: string): Promise<LoadedModel | undefined> {
  const manifest = await loadManifest();
  assetStatus.manifest = manifest ? "ok" : "missing";
  const entry = manifest?.[table][name];
  if (!entry) {
    assetStatus.modelsMissing++;
    return undefined;
  }
  const gltf = await loadGltf(entry.path);
  if (!gltf) {
    assetStatus.modelsMissing++;
    return undefined;
  }
  assetStatus.modelsOk++;
  const scene = cloneSkeleton(gltf.scene) as THREE.Group;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { scene, animations: gltf.animations, entry };
}

/** A furniture/prop model by manifest name, or undefined. Each call
 *  returns a NEW instance; the underlying glTF is fetched once. */
export function loadModel(name: string): Promise<LoadedModel | undefined> {
  return loadModelFrom("models", name);
}

/** A character model (skinned, with idle/walk clips) by manifest name. */
export function loadCharacter(name: string): Promise<LoadedModel | undefined> {
  return loadModelFrom("characters", name);
}

/** Uniformly scale + ground `obj` so its bounding box matches `target`
 *  (metres) as closely as one uniform scale allows, with its base at y=0
 *  and its footprint centred on the local origin. */
export function fitToFootprint(obj: THREE.Object3D, target: { w: number; d: number; h: number }): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x <= 0 || size.y <= 0 || size.z <= 0) return;
  const s = Math.min(target.w / size.x, target.h / size.y, target.d / size.z);
  obj.scale.multiplyScalar(s);
  const box2 = new THREE.Box3().setFromObject(obj);
  const center = new THREE.Vector3();
  box2.getCenter(center);
  obj.position.x -= center.x;
  obj.position.z -= center.z;
  obj.position.y -= box2.min.y;
}

// -- environment ---------------------------------------------------------------

let envPromise: Promise<THREE.Texture | undefined> | undefined;

/** The HDR environment (PMREM-filtered) for PBR reflections, or undefined. */
export function loadEnvironment(renderer: THREE.WebGLRenderer): Promise<THREE.Texture | undefined> {
  if (!envPromise) {
    envPromise = loadManifest().then((manifest) => {
      const env = manifest?.env;
      if (!env) return undefined;
      return new Promise<THREE.Texture | undefined>((resolve) => {
        new RGBELoader().load(
          env.path.startsWith("/") ? env.path : `${ASSET_ROOT}/${env.path}`,
          (hdr) => {
            const pmrem = new THREE.PMREMGenerator(renderer);
            pmrem.compileEquirectangularShader();
            const envMap = pmrem.fromEquirectangular(hdr).texture;
            hdr.dispose();
            pmrem.dispose();
            resolve(envMap);
          },
          undefined,
          () => resolve(undefined)
        );
      });
    });
  }
  return envPromise;
}
