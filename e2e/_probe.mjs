// Scratch probe (not committed): prints facts about the reference plant and scenarios.
import { chromium } from "playwright";

const BASE = process.env.FORGELAB_URL ?? "http://localhost:3104";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.addInitScript(() =>
  localStorage.setItem(
    "forgelab.presentation.v1",
    JSON.stringify({ quality: "LOW", bloom: false, haze: false, muted: true }),
  ),
);
await page.goto(`${BASE}/app?debug&new=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Blank project/ }).click();
if (!(await page.evaluate(() => !!window.__forgelab)))
  await page.goto(`${BASE}/app?debug`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__forgelab?.three);
const facts = {};
for (const id of ["reference-plant"]) {
  await page.evaluate((id) => window.__forgelab.loadBlueprint(id), id);
  await page.waitForTimeout(800);
  facts[id] = await page.evaluate(() =>
    window.__forgelab.store.getView().snapshot.components.map((c) => ({
      id: c.id,
      type: c.type,
      role: c.role,
      g: c.geometry,
      p: c.transform.positionM,
      params: c.role === "vacuum-vessel" || c.role === "controller" ? c.parameters : undefined,
    })),
  );
}
const scen = await page.evaluate(() => window.__forgelab.scenarios);
facts.scenarios = {};
for (const id of scen) {
  await page.evaluate((id) => window.__forgelab.loadScenario(id), id);
  await page.waitForTimeout(500);
  facts.scenarios[id] = await page.evaluate(() =>
    window.__forgelab.store
      .getView()
      .snapshot.components.map((c) => `${c.id}:${c.type}:${c.role}@${c.transform.positionM.x.toFixed(1)},${c.transform.positionM.y.toFixed(1)},${c.transform.positionM.z.toFixed(1)}`),
  );
}
console.log(JSON.stringify(facts, null, 1));
await browser.close();
