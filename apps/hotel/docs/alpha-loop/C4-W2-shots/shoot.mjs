// C4-W2 evidence shooter: tour.html poses on port 5203, real GPU chrome.
// usage: node shoot.mjs <outdir> <name> <query>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
const name = process.argv[3];
const query = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:5203/dev/tour.html?${query}`);
await page.waitForTimeout(6000);
await page.screenshot({ path: join(out, `${name}.png`) });
console.log("shot", name, "saved");
await browser.close();
