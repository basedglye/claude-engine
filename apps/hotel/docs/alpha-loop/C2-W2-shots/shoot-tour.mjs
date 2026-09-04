// C2-W2 evidence shooter: tour.html poses on port 5204, real GPU chrome.
// usage: node shoot-tour.mjs <outdir> <prefix> <poses.json>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const prefix = process.argv[3];
const poses = JSON.parse(process.argv[4]);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
let first = true;
for (const p of poses) {
  await page.goto(`http://localhost:5204/dev/tour.html?${p.q}`);
  await page.waitForTimeout(first ? 6000 : 3500);
  first = false;
  await page.screenshot({ path: join(out, `${prefix}-${p.name}.png`) });
  let tris = "n/a";
  try { tris = await page.evaluate(() => document.body.innerText.match(/triangles:\s*(\d+)/)?.[1] ?? "n/a"); } catch {}
  console.log("shot", p.name, "triangles", tris);
}
await browser.close();
