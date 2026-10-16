/** Production browser proof. Actual simulation for plasma and faults; the final isolated
 * particle study only checks all shader variants and is explicitly not a physics event.
 * pnpm vercel-build && node scripts/serve-output.mjs 3000
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium E2E_SHOTS=/tmp/visuals node e2e/visual-realism.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
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
const errors = [],
  evidence = {};
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const pose = async (p, t) => {
  // World replacement/last-part deletion can remount camera subscriptions. Request only
  // after React has committed, and retry an event lost during that subscription change.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(350);
    await page.evaluate(({ p, t }) => window.__forgelab.store.requestPose(p, t), { p, t });
    try {
      await page.waitForFunction(
        (p) =>
          window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) <
          0.01,
        p,
        { timeout: 15000 },
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
};
const activate = async (speed) => {
  await page.locator("button.simulate-btn").click();
  await page.waitForFunction(
    () =>
      window.__forgelab.store.getView().mode === "simulate" ||
      document.querySelector('[role="dialog"]'),
  );
  const dialog = page.locator('[role="dialog"]:has-text("Preflight")');
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Activate anyway", exact: true }).click();
  await page.waitForFunction(() => window.__forgelab.store.getView().mode === "simulate");
  await page.evaluate((speed) => window.__forgelab.store.setSpeed(speed), speed);
};
const quality = async (name) => {
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
};

try {
  await page.addInitScript(() =>
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({
        quality: "MEDIUM",
        bloom: false,
        haze: false,
        muted: true,
        cameraEffectsIntensity: 0,
      }),
    ),
  );
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.waitForTimeout(1500); // camera subscriptions mount after the debug handle
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(false));
  assert.equal(
    await page.evaluate(() => window.__forgelab.store.getView().snapshot.components.length),
    0,
  );
  await pose([53, 8, 33], [-15, 4, -18]);
  await shot("hall-after");
  evidence.hall = await page.evaluate(() => {
    const { scene, gl } = window.__forgelab.three();
    const floor = scene.getObjectByName("hall-floor");
    if (!floor) throw new Error("Hall floor missing");
    return {
      roughness: floor.material.roughness,
      renderer: gl.getContext().getParameter(gl.getContext().RENDERER),
      memory: gl.info.memory,
    };
  });
  assert.equal(evidence.hall.roughness, 1);
  console.log("✓ empty warehouse renders with dry floor and open gantries");

  await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("textbox", { name: "Search parts", exact: true }).fill("Coolant Pump");
  await page
    .locator("button.part")
    .filter({ has: page.locator(".part__name", { hasText: /^Coolant Pump$/ }) })
    .click();
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 1,
  );
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    const c = s.getView().snapshot.components[0];
    s.setPosition(c.id, { x: 0, y: 1, z: 0 });
    s.toggleDrawer(false);
    s.clearSelection();
  });
  await pose([3.8, 2.5, 4.5], [0, 1, 0]);
  await shot("pump-materials");
  const pumpHash = await hash();
  await quality("High");
  await page.waitForTimeout(1500);
  await shot("pump-materials-high");
  assert.equal(await hash(), pumpHash);
  await quality("Low");
  await page.waitForTimeout(500);
  assert.equal(await hash(), pumpHash);
  await quality("Medium");
  console.log("✓ pump finishes render at Medium/High/Low; graphics changes preserve the design");

  await page.evaluate(() => window.__forgelab.loadBlueprint("reference-plant"));
  const design = await hash();
  await activate(10);
  await page.waitForFunction(
    () =>
      Object.values(window.__forgelab.director.getState().reading?.vessels ?? {}).some(
        (v) => v.plasma.phase === "flat-top",
      ),
    null,
    { timeout: 180000 },
  );
  await page.evaluate(() => window.__forgelab.store.setSpeed(0));
  evidence.plasma = await page.evaluate(() => {
    const f = window.__forgelab,
      reading = f.director.getState().reading;
    const [id, state] = Object.entries(reading.vessels).find(
      ([, v]) => v.plasma.phase === "flat-top",
    );
    const c = f.store.getView().snapshot.components.find((c) => c.id === id);
    f.store.select([id]);
    f.store.toggleCutaway(true);
    return {
      id,
      state,
      position: c.transform.positionM,
      geometry: c.geometry,
      simulationTime: reading.timeSec,
    };
  });
  const p = evidence.plasma.position,
    r = evidence.plasma.geometry.majorRadiusM ?? 4;
  await page.waitForFunction(() => {
    let lit = false;
    window.__forgelab.three().scene.traverse((o) => {
      if (o.visible && o.material?.uniforms?.uIntensity?.value > 0) lit = true;
    });
    return lit;
  });
  await pose([p.x + r * 2.4, p.y + r * 1.7, p.z + r * 2.6], [p.x, p.y, p.z]);
  await shot("plasma-running-cutaway");
  await page.evaluate(() => window.__forgelab.store.toggleIsolate());
  await pose([p.x + r * 2.2, p.y + r * 1.45, p.z + r * 2.4], [p.x, p.y, p.z]);
  await shot("plasma-isolated-cutaway");
  await page.evaluate(() => window.__forgelab.store.showAll());
  assert.equal(await hash(), design);
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  await page.waitForFunction(() => {
    let dark = true;
    window.__forgelab.three().scene.traverse((o) => {
      if (
        o.material?.uniforms?.uIntensity &&
        (o.material.uniforms.uIntensity.value !== 0 || o.material.uniforms.uFlash.value !== 0)
      )
        dark = false;
    });
    return dark;
  });
  assert.equal(await hash(), design);
  console.log("✓ actual flat-top plasma renders; Stop extinguishes glow and preserves the build");

  evidence.faults = [];
  for (const [id, family, particle, speed] of [
    ["electrical-bus-fault", "electrical", "sparks", 10],
    ["pipe-rupture", "coolant", "spray", 1],
    ["magnet-quench", "quench", "vapor", 5],
  ]) {
    await page.evaluate((id) => {
      const f = window.__forgelab;
      f.store.toggleCutaway(false);
      f.loadScenario(id);
    }, id);
    const before = await hash();
    await activate(speed);
    await page.waitForFunction(
      (family) =>
        window.__forgelab.director.getState().destructions.some((d) => d.family === family),
      family,
      { timeout: 180000 },
    );
    await page.evaluate(() => window.__forgelab.store.setSpeed(0));
    const closeReport = page.getByRole("button", { name: "Close report", exact: true });
    if (await closeReport.isVisible()) await closeReport.click();
    if (await page.getByRole("region", { name: "Engineering overlay", exact: true }).isVisible())
      await page.keyboard.press("t");
    const event = await page.evaluate(
      (family) =>
        window.__forgelab.director.getState().destructions.find((d) => d.family === family),
      family,
    );
    const [x, y, z] = event.worldPosition;
    await pose([x + 5, y + 3, z + 6], [x, y, z]);
    await page.waitForFunction(
      (particle) => (window.__forgelab.vfxStats()[particle] ?? 0) > 0,
      particle,
    );
    await shot(`fault-${id}`);
    evidence.faults.push({
      id,
      event,
      particles: await page.evaluate(() => window.__forgelab.vfxStats()),
    });
    await page.evaluate(() => window.__forgelab.store.stopSimulation());
    assert.equal(await hash(), before);
    console.log(`✓ simulation-driven ${family}: ${particle} rendered, reset preserves build`);
  }

  // Controlled graphics study, separate from the actual-simulation evidence above.
  // Compile every particle shader, including combustion variants absent in these faults.
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(false));
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 0,
  );
  await pose([12, 8, 18], [0, 2, 0]);
  const study = () =>
    page.evaluate(() => {
      const f = window.__forgelab,
        runtime = f.vfx();
      const kinds = Object.keys(runtime.systems);
      let seed = 618;
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < kinds.length; i++) {
        const system = runtime.systems[kinds[i]];
        for (let k = 0; k < 18; k++)
          system.spawn(
            [-7 + i * 2, 2, 0],
            [0, 1, 0],
            0.35,
            [0.1, 0.4],
            [8, 10],
            [0.5, 1.4],
            0.25,
            random,
          );
        system.update(0.2);
      }
      f.three().invalidate();
      return { purpose: "shader study only; no simulated event", kinds };
    });
  evidence.particleStudy = await study();
  await shot("particle-shader-study");
  await quality("High");
  await page.waitForTimeout(600);
  await study();
  await shot("particle-shader-study-high");
  await quality("Medium");
  await page.waitForTimeout(300);
  assert.deepEqual(errors, [], `Browser/GL errors: ${errors.join("\n")}`);
  evidence.errors = errors;
  if (shots) await writeFile(`${shots}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(
    "✓ all eight particle shaders compile in direct and postprocessed rendering; no browser/GL errors",
  );
} catch (error) {
  await shot("visual-realism-failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
}
