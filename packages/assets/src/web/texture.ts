import * as THREE from "three";

/**
 * Rasterizes a generated SVG string into a THREE.Texture via an offscreen
 * <canvas>. Browser-only (uses Image, Blob, URL, canvas 2D).
 */
export function svgToTexture(svg: string, sizePx = 256): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = sizePx;
        canvas.height = sizePx;
        const ctx2d = canvas.getContext("2d");
        if (!ctx2d) {
          reject(new Error("svgToTexture: 2D canvas context unavailable"));
          return;
        }
        ctx2d.clearRect(0, 0, sizePx, sizePx);
        ctx2d.drawImage(img, 0, 0, sizePx, sizePx);
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        resolve(texture);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("svgToTexture: failed to rasterize SVG"));
    };
    img.src = url;
  });
}
