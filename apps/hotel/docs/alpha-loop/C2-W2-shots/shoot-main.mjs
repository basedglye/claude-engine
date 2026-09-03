import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5204/?worldforgeSeed=hotel-alpha-loop-1&worldforgeQuality=high&hotelTier=0");
await page.waitForTimeout(9000);
await page.screenshot({ path: "main-app-tier0.png" });
console.log("done");
await browser.close();
