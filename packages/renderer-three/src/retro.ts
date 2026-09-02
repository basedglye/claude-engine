/**
 * The PS1 look, and the instancing helper that keeps it inside the draw-call
 * budget (docs/PHASE-H2.md section 5E; apps/hotel/docs/ARCHITECTURE.md B6).
 *
 * Two effects, both classic PlayStation-era artefacts, both implemented as
 * `onBeforeCompile` injections into a stock Three material so nothing here
 * forks Three's lighting/fog/tonemapping chunks:
 *
 *   1. VERTEX JITTER. The hardware had no sub-pixel raster precision, so
 *      projected vertices snapped to a coarse grid and geometry visibly
 *      wobbled as the camera moved. Reproduced by quantizing the projected
 *      position in NDC: divide by w, floor onto a grid derived from
 *      `jitterGridPx`, multiply back by w.
 *
 *   2. AFFINE UV WARP. The hardware interpolated texture coordinates in
 *      screen space with no perspective divide, so textures swam on
 *      floors and walls. WebGL interpolates varyings WITH perspective
 *      correction and GLSL ES 1.00 has no `noperspective` qualifier, so
 *      the standard workaround is used instead: multiply the uv by `w` in
 *      the vertex shader and divide by the interpolated `w` in the
 *      fragment shader. Perspective correction divides both by w on the
 *      way through, so the two cancel and what survives is screen-linear
 *      (i.e. affine) interpolation. No extension, no GLSL3 requirement.
 *
 * `exempt: true` builds the same material through the same factory with
 * BOTH injections compiled out. ARCHITECTURE B6 requires the surface-ui
 * screen quads to be excluded — affine warp on an 8x8 bitmap font destroys
 * text legibility, and H1b measured what that costs (mip filtering alone
 * collapsed the calibration contrast from 241 to 41). Routing the screen
 * quad through THIS function with `exempt: true`, rather than letting it
 * keep an unrelated material, is what makes the exemption structural: one
 * factory, one place where the effects can be turned on, and a gate
 * (`art-lock`) that measures the screen with the shader live everywhere
 * else.
 *
 * IMPLEMENTER DEVIATION FROM THE SPEC'S SIGNATURE (flagged for review):
 * `unlit?: boolean` is an additive optional field the spec does not list.
 * It exists because the exempt path has a hard requirement the lit path
 * does not: the screen quad must render its CanvasTexture at full value,
 * unmodulated by scene lighting, or the readability probe's calibration
 * strip is measuring the lighting rig rather than the texture (the H1b
 * screen shipped as MeshBasicMaterial for exactly this reason). Rather
 * than have the screen keep a separately-constructed material — the very
 * thing that lets an exemption drift — the field selects the base class
 * inside this one factory. Default is `false`, so every world surface is
 * unaffected.
 */
import * as THREE from "three";

export interface RetroLook {
  /** Projected-position quantization grid, in virtual pixels across the
   *  smaller viewport axis. Smaller = coarser = more wobble. */
  jitterGridPx: number;
  affineWarp: boolean;
}

export interface RetroMaterialOptions {
  map?: THREE.Texture;
  vertexColors: boolean;
  look: RetroLook;
  /** Compile BOTH effects out — the screen-quad path (ARCHITECTURE B6). */
  exempt?: boolean;
  /** See the deviation note in this file's header comment. */
  unlit?: boolean;
}

/** Marker read by tests and by the `art-lock` gate's page-side assertions:
 *  a material built by this factory records what it actually compiled, so
 *  "the screen is exempt" is checkable at runtime rather than by reading
 *  the call site. */
export interface RetroMaterialFlags {
  retro: true;
  jitter: boolean;
  affine: boolean;
  exempt: boolean;
}

export function createRetroMaterial(opts: RetroMaterialOptions): THREE.Material {
  const exempt = opts.exempt === true;
  const jitter = !exempt;
  // The affine path reads `vMapUv`, which Three only declares when the
  // material actually has a map. Warping an untextured surface would
  // also be a no-op, so gate on the map rather than compiling dead code.
  const affine = !exempt && opts.look.affineWarp && opts.map !== undefined;

  const params = {
    map: opts.map,
    vertexColors: opts.vertexColors,
  };
  const material: THREE.Material = opts.unlit
    ? new THREE.MeshBasicMaterial(params)
    : new THREE.MeshLambertMaterial(params);

  if (!exempt) {
    const jitterGridPx = Math.max(1, opts.look.jitterGridPx);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uJitterGridPx = { value: jitterGridPx };

      // -- vertex --------------------------------------------------------
      // `project_vertex` is the chunk that finally writes gl_Position, so
      // everything below hangs off its tail: both effects need the
      // post-projection value, which is why neither can live earlier.
      const vertexHead = ["#include <common>", "uniform float uJitterGridPx;"];
      if (affine) vertexHead.push("varying vec2 vRetroUv;", "varying float vRetroW;");

      const vertexBody = [
        "#include <project_vertex>",
        // Quantize in NDC then restore the w scale. `abs(w)` guards the
        // behind-camera case, where a signed w flips the grid and makes
        // clipped geometry flicker violently instead of merely wobbling.
        "{",
        "  float retroW = max(abs(gl_Position.w), 1e-4);",
        "  vec2 retroGrid = vec2(uJitterGridPx);",
        "  vec2 retroNdc = gl_Position.xy / retroW;",
        "  retroNdc = floor(retroNdc * retroGrid) / retroGrid;",
        "  gl_Position.xy = retroNdc * retroW * sign(gl_Position.w);",
        "}",
      ];
      if (affine) {
        // Perspective correction divides an interpolated varying by w on
        // the way to the fragment stage; pre-multiplying by w here and
        // dividing by the interpolated w there cancels it, leaving
        // screen-linear (affine) interpolation. GLSL ES 1.00 has no
        // `noperspective`, so this is the portable way to get it.
        vertexBody.push(
          "vRetroW = max(abs(gl_Position.w), 1e-4);",
          "vRetroUv = vMapUv * vRetroW;"
        );
      }

      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", vertexHead.join("\n"))
        .replace("#include <project_vertex>", vertexBody.join("\n"));

      // -- fragment ------------------------------------------------------
      if (affine) {
        // `vMapUv` is an `in` varying in the fragment stage (Three compiles
        // to GLSL ES 3.00 on WebGL2), so it cannot be reassigned there.
        // Replace the map fetch itself instead. Three decodes the texture's
        // colour space through the sampler's own format since r152, so a
        // plain texture2D here is not dropping a decode step.
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            ["#include <common>", "varying vec2 vRetroUv;", "varying float vRetroW;"].join("\n")
          )
          .replace(
            "#include <map_fragment>",
            [
              "#ifdef USE_MAP",
              "  diffuseColor *= texture2D( map, vRetroUv / vRetroW );",
              "#endif",
            ].join("\n")
          );
      }
    };
    // Three caches compiled programs by a key that does NOT include an
    // onBeforeCompile body; two materials with different injections but
    // identical parameters would otherwise share one program. Distinguish
    // them explicitly.
    material.customProgramCacheKey = () => `retro:${jitterGridPx}:${affine ? "affine" : "plain"}`;
  }

  const flags: RetroMaterialFlags = { retro: true, jitter, affine, exempt };
  (material as THREE.Material & { retroFlags: RetroMaterialFlags }).retroFlags = flags;
  return material;
}

/** Read back what a material actually compiled — undefined for anything
 *  this factory did not build. The `art-lock` gate uses it to prove the
 *  screen quad is exempt WHILE the rest of the scene is not, which is a
 *  stronger statement than "the probe still passes". */
export function retroFlagsOf(material: THREE.Material): RetroMaterialFlags | undefined {
  return (material as THREE.Material & { retroFlags?: RetroMaterialFlags }).retroFlags;
}

export interface InstancedScenery {
  mesh: THREE.InstancedMesh;
  set(i: number, m: THREE.Matrix4): void;
  count(n: number): void;
}

/**
 * One instanced draw call per (geometry, material) kind. The draw-call
 * budget (<= 300, ARCHITECTURE B6) is not reachable with one Mesh per prop
 * once a hotel is full of messes and furniture, and instancing is the
 * cheapest way to collapse them without merging geometry the sim keeps
 * moving.
 *
 * `capacity` is fixed at construction (an InstancedMesh cannot grow), so
 * callers size it to the worst case they can justify and use `count()` to
 * hide the unused tail. Instances beyond `capacity` are dropped by `set()`
 * rather than throwing — a dropped decoration is a visual bug, a thrown
 * exception in a render callback is a black screen.
 */
export function instancedScenery(opts: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  capacity: number;
}): InstancedScenery {
  const mesh = new THREE.InstancedMesh(opts.geometry, opts.material, Math.max(0, opts.capacity));
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Instanced scenery is placed from sim positions each frame and can sit
  // anywhere in the level; a stale bounding sphere computed from instance 0
  // frustum-culls the whole batch out of view at the worst moment.
  mesh.frustumCulled = false;
  return {
    mesh,
    set(i: number, m: THREE.Matrix4): void {
      if (i < 0 || i >= mesh.instanceMatrix.count) return;
      mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
    },
    count(n: number): void {
      mesh.count = Math.max(0, Math.min(mesh.instanceMatrix.count, n));
    },
  };
}
