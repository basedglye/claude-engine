/**
 * Render quality tier, decided once at module load. Presentation-only.
 *
 * "high" is the real-hotel look: CC0 textures, glTF models, shadows, the
 * HDR environment. "low" is the flat-colour procedural build with no
 * shadows and no texture/model fetches — what the harness's headless
 * SwiftShader browser gates get, because under software rendering the
 * full look measured 1–3 s per frame and every tick-gated browser gate
 * would crawl (docs/PLAN-ALPHA.md §4.7's two-number rule: software
 * rendering is for regression detection, not for the look).
 *
 * Resolution order: `?worldforgeQuality=low|high` on the URL wins; else a
 * software GL renderer (SwiftShader / llvmpipe / Mesa software) selects
 * "low"; else "high". Nothing here reaches the sim.
 */
export type RenderQuality = "low" | "high";

function detect(): RenderQuality {
  if (typeof window === "undefined") return "low";
  const param = new URLSearchParams(window.location.search).get("worldforgeQuality");
  if (param === "low" || param === "high") return param;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return "low";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const lower = renderer.toLowerCase();
    if (lower.includes("swiftshader") || lower.includes("llvmpipe") || lower.includes("software")) return "low";
    return "high";
  } catch {
    return "low";
  }
}

export const RENDER_QUALITY: RenderQuality = detect();
export const HIGH_QUALITY = RENDER_QUALITY === "high";
