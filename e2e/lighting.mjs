/**
 * Local-only visual/interaction checks against a production build. No cloud keys needed.
 * pnpm vercel-build && node scripts/serve-output.mjs 3000
 * E2E_SHOTS=/tmp/lighting node e2e/lighting.mjs http://localhost:3000
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use an installed Chromium.
 */
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.env.E2E_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/lighting-${name}.png` });
};
const settle = () => page.waitForTimeout(1200);
const shadow = () =>
  page.evaluate(() => {
    const { scene } = window.__forgelab.three();
    const s = scene.getObjectByName("hall-key").shadow;
    const c = s.camera;
    return { width: c.right - c.left, height: c.top - c.bottom, resolution: s.mapSize.x };
  });

try {
  await page.addInitScript(() => {
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({ quality: "MEDIUM", bloom: false, haze: false, muted: true }),
    );
  });
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug { display: none !important; }" });
  await settle();
  assert.equal(
    await page.evaluate(() => window.__forgelab.store.getView().snapshot.components.length),
    0,
  );
  await shot("empty");
  console.log("✓ empty hall renders");

  await page.evaluate(() => {
    window.__forgelab.store.addPart("coolant-pump", { x: 0, y: 0, z: 0 });
    window.__forgelab.store.requestPose([0, 12, 0.01], [0, 0, 0]);
  });
  await page.waitForFunction(() => {
    const c = window.__forgelab.three().scene.getObjectByName("hall-key").shadow.camera;
    return c.right - c.left <= 40 && c.top - c.bottom <= 40;
  });
  const small = await shadow();
  assert(small.width <= 40 && small.height <= 40, JSON.stringify(small));
  const pumpHash = await hash();
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    const pump = s.getView().snapshot.components[0];
    s.setPosition(pump.id, { x: 180, y: 0, z: -140 });
  });
  await settle();
  assert.notEqual(await hash(), pumpHash);
  // Check the actual GPU projection, including designs outside the hall footprint.
  await page.waitForFunction(() => {
    const f = window.__forgelab;
    const { scene } = f.three();
    const c = scene.getObjectByName("hall-key").shadow.camera;
    const p = f.store.getView().snapshot.components[0].state.physical.positionM;
    const point = c.position.clone().set(p.x, p.y, p.z).project(c);
    return Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1;
  });
  await page.evaluate(() => window.__forgelab.store.undo());
  await settle();
  assert.equal(await hash(), pumpHash);
  console.log("✓ small-machine shadow detail, off-site placement and undo");

  await page.evaluate(() => {
    window.__forgelab.loadBlueprint("iter-class-plant");
    window.__forgelab.store.requestPose([58, 30, 60], [-4, 4, -8]);
  });
  await settle();
  const design = await hash();
  await shot("plant-medium");
  for (const quality of ["Low", "High", "Ultra", "Medium"]) {
    await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
    await page.getByRole("menuitemradio", { name: quality, exact: true }).click();
    await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
    await settle();
    const expected = { Low: 1024, Medium: 2048, High: 2048, Ultra: 4096 }[quality];
    await page.waitForFunction(
      (resolution) =>
        window.__forgelab.three().scene.getObjectByName("hall-key").shadow.mapSize.x === resolution,
      expected,
    );
    await page.waitForFunction(
      (reflective) => {
        const m = window.__forgelab.three().scene.getObjectByName("hall-floor").material;
        return m.isMeshStandardMaterial && m.map !== null && "mixStrength" in m === reflective;
      },
      quality === "High" || quality === "Ultra",
    );
    assert.equal(await hash(), design);
    if (quality === "High") await shot("plant-high");
  }
  console.log("✓ all four graphics tiers preserve the design and set the shadow budget");

  for (const name of ["Dark Research Facility", "Empty Engineering Grid", "Main Reactor Hall"]) {
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await settle();
    assert.equal(await hash(), design);
    if (name === "Dark Research Facility") await shot("plant-night");
  }
  await page.evaluate(() => window.__forgelab.store.setExplode(0.5));
  await settle();
  assert.equal(await hash(), design);
  await shot("exploded");
  await page.evaluate(() => window.__forgelab.store.setExplode(0));
  await settle();
  assert.equal(await hash(), design);
  console.log("✓ environment and exploded inspection remain presentation only");

  await page.waitForTimeout(2500);
  const frames = await page.evaluate(() => window.__forgelab.three().gl.info.render.frame);
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => window.__forgelab.three().gl.info.render.frame), frames);
  console.log("✓ a stationary build view stops rendering");

  await page.evaluate(() => window.__forgelab.loadScenario("pipe-rupture"));
  await settle();
  const beforeRun = await hash();
  await page.locator("button.simulate-btn").click();
  const preflight = page.locator('[role="dialog"]:has-text("Preflight")');
  await preflight.getByRole("button", { name: "Activate anyway", exact: true }).click();
  await page.waitForFunction(() =>
    window.__forgelab.director.getState().destructions.some((d) => d.family === "coolant"),
  );
  await shot("pipe-rupture");
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  await settle();
  assert.equal(await hash(), beforeRun);
  console.log("✓ preflight, coolant failure presentation and exact return to build");

  assert.deepEqual(errors, []);
  console.log("✓ no browser runtime errors");
} finally {
  await browser.close();
}
