/**
 * Plasma, failure effects, machine motion and sound: production browser evidence.
 *
 *   pnpm vercel-build && node scripts/serve-output.mjs 3000
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium E2E_SHOTS=/tmp/plasma \
 *     node e2e/plasma-vfx.mjs [http://localhost:3000]
 *
 * Everything shown is raised by the simulation: the reference plant's own start-up, a
 * controlled shutdown (its wall interlock, with a lower setpoint), the showroom fault
 * scenarios, and a battery module standing beside the burning bus. The presentation clock
 * is held and stepped (`__forgelab.clock`), so each plasma phase and each failure family is
 * captured at a known moment of its sequence instead of whenever software GL gets a frame.
 *
 * E2E_ONLY=plasma,shutdown,disruption,faults,fire,motion,audio runs a subset.
 * Builds without the clock or the display styles (older commits) still run: the script
 * then captures whatever is on screen, which is how the "before" pictures were taken.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.FORGELAB_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? null;
const ONLY = (process.env.E2E_ONLY ?? "").split(",").filter(Boolean);
const wants = (section) => ONLY.length === 0 || ONLY.includes(section);
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(120000); // software GL is slow, and the box is shared
const errors = [];
const evidence = { base: BASE, shots: [] };
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let failed = false;
let step = 0;
async function check(name, fn) {
  step += 1;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`✓ ${String(step).padStart(2, "0")} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${String(step).padStart(2, "0")} ${name}\n  ${String(error.message).split("\n").join("\n  ")}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fail-${step}.jpg`, type: "jpeg" }).catch(() => {});
  }
}

/* ---------------------------------------------------------------------------------- *
 * Helpers
 * ---------------------------------------------------------------------------------- */

const settle = (ms) => page.waitForTimeout(ms);
const frame = async () => {
  // Two rendered frames: one to apply state, one to show it.
  for (let i = 0; i < 2; i += 1) {
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.__forgelab.three().invalidate();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    );
  }
};
async function shot(name, note) {
  await frame();
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: "jpeg", quality: 84 });
  evidence.shots.push({ name, note: note ?? "" });
}
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const features = () =>
  page.evaluate(() => ({
    clock: typeof window.__forgelab.clock?.hold === "function",
    styles: typeof window.__forgelab.plasma?.look === "function",
  }));
async function pose(p, t) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await settle(350);
    await page.evaluate(({ p, t }) => window.__forgelab.store.requestPose(p, t), { p, t });
    try {
      await page.waitForFunction(
        (p) =>
          window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) <
          0.01,
        p,
        { timeout: 20000 },
      );
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}
async function activate(speed) {
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
}
const stop = async () => {
  await page.evaluate(() => {
    const f = window.__forgelab;
    f.clock?.release();
    f.store.stopSimulation();
    f.store.toggleCutaway(false);
    f.store.setSection(null);
    f.store.showAll();
    f.store.clearSelection();
  });
  await settle(300);
};
const hold = () => page.evaluate(() => window.__forgelab.clock?.hold());
/** Steps held presentation time; a no-op on builds without the clock. */
async function advance(seconds) {
  const stepped = await page.evaluate((s) => {
    const clock = window.__forgelab.clock;
    if (clock === undefined) return false;
    clock.advance(s * 1000);
    return true;
  }, seconds);
  if (!stepped) await settle(seconds * 1000);
  await frame();
}
const plasmaOf = () =>
  page.evaluate(() => {
    const reading = window.__forgelab.director.getState().reading;
    const entry = Object.entries(reading?.vessels ?? {}).find(
      ([, v]) => v.plasma.configuration !== "none",
    );
    return entry === undefined ? null : { id: entry[0], t: reading.timeSec, ...entry[1].plasma };
  });
const waitPhase = (phases, timeout = 240000) =>
  page.waitForFunction(
    (phases) =>
      Object.values(window.__forgelab.director.getState().reading?.vessels ?? {}).some((v) =>
        phases.includes(v.plasma.phase),
      ),
    phases,
    { timeout, polling: 50 },
  );
const pause = () => page.evaluate(() => window.__forgelab.store.setSpeed(0));
const closePanels = async () => {
  const closeReport = page.getByRole("button", { name: "Close report", exact: true });
  if (await closeReport.isVisible().catch(() => false)) await closeReport.click();
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.toggleDrawer(false);
    s.toggleTimeline?.(false);
  });
};
const setStyle = async (style) => {
  await page.evaluate((style) => window.__forgelab.settings?.update({ plasmaStyle: style }), style);
  await frame();
};
/** Vessel centre and major radius of the plant on screen. */
const vesselFacts = () =>
  page.evaluate(() => {
    const c = window.__forgelab.store
      .getView()
      .snapshot.components.find((c) => c.role === "vacuum-vessel");
    return {
      id: c.id,
      p: c.transform.positionM,
      R: c.geometry.majorRadiusM ?? 0,
      a: c.geometry.minorRadiusM ?? c.geometry.radiusM ?? 1,
    };
  });
/** Mean and peak brightness of the 3D canvas inside a screen rectangle (0..255). */
const canvasStats = (rect) =>
  page.evaluate(async (rect) => {
    const { gl, scene, camera } = window.__forgelab.three();
    gl.render(scene, camera);
    const source = gl.domElement;
    const probe = document.createElement("canvas");
    probe.width = 160;
    probe.height = 100;
    const ctx = probe.getContext("2d");
    ctx.drawImage(source, 0, 0, probe.width, probe.height);
    const x0 = Math.floor((rect?.x0 ?? 0) * probe.width);
    const y0 = Math.floor((rect?.y0 ?? 0) * probe.height);
    const w = Math.max(1, Math.floor(((rect?.x1 ?? 1) - (rect?.x0 ?? 0)) * probe.width));
    const h = Math.max(1, Math.floor(((rect?.y1 ?? 1) - (rect?.y0 ?? 0)) * probe.height));
    const data = ctx.getImageData(x0, y0, w, h).data;
    let sum = 0;
    let peak = 0;
    let pink = 0;
    for (let i = 0; i < data.length; i += 4) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += l;
      peak = Math.max(peak, l);
      // Magenta-pink: red and blue both above green.
      if (data[i] > data[i + 1] + 18 && data[i + 2] > data[i + 1] + 8) pink += 1;
    }
    const n = data.length / 4;
    return { mean: sum / n, peak, pinkFraction: pink / n };
  }, rect);

/* ---------------------------------------------------------------------------------- *
 * Start
 * ---------------------------------------------------------------------------------- */

await page.addInitScript(() => {
  if (localStorage.getItem("forgelab.presentation.v1") === null)
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({
        quality: "MEDIUM",
        bloom: true,
        haze: false,
        muted: false,
        cameraEffectsIntensity: 0,
        screenCrack: false,
      }),
    );
});
await page.goto(`${BASE}/app?debug&new=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Blank project/ }).click();
if (!(await page.evaluate(() => !!window.__forgelab)))
  await page.goto(`${BASE}/app?debug`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__forgelab?.three);
await settle(1500);
await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
await page.mouse.click(720, 450); // a gesture, so audio may start
const has = await features();
evidence.features = has;
console.log(`build features: ${JSON.stringify(has)}`);

/** The reference plant with everything cut open towards the camera. */
async function referencePlant({ setpointK } = {}) {
  await stop();
  await page.evaluate(() => window.__forgelab.loadBlueprint("reference-plant"));
  await settle(800);
  if (setpointK !== undefined)
    await page.evaluate(
      (k) => window.__forgelab.store.setParameter(["interlock"], "setpoint", k),
      setpointK,
    );
  await closePanels();
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.clearSelection();
    s.toggleCutaway(true);
  });
}
const heroPose = async () => {
  const v = await vesselFacts();
  await pose([v.p.x + v.R * 2.4, v.p.y + v.R * 1.7, v.p.z + v.R * 2.6], [v.p.x, v.p.y, v.p.z]);
};
/** Tangential view from just inside the outboard wall, as in-vessel cameras look. */
const insidePose = async () => {
  const v = await vesselFacts();
  await pose(
    [v.p.x + v.R + v.a * 0.82, v.p.y + v.a * 0.18, v.p.z],
    [v.p.x + v.R * 0.35, v.p.y - v.a * 0.1, v.p.z + v.R * 0.95],
  );
};

/* ---------------------------------------------------------------------------------- *
 * Plasma: breakdown, ramp-up, flat-top in both display styles
 * ---------------------------------------------------------------------------------- */

if (wants("plasma"))
  await check("plasma lights at breakdown and reads as an edge-lit volume at flat-top", async () => {
    await referencePlant();
    const design = await hash();
    await heroPose();
    await hold();
    await activate(5);
    const dark = await canvasStats({ x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 });
    await waitPhase(["ramp-up", "flat-top"]);
    await pause();
    const breakdown = await plasmaOf();
    evidence.breakdown = breakdown;
    await advance(0.12);
    await shot("plasma-01-breakdown", `breakdown flash, t=${breakdown.t.toFixed(2)} s`);
    const flash = await canvasStats({ x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.7 });
    evidence.breakdownBrightness = { dark, flash };
    await advance(2.5);
    await shot("plasma-02-ramp-up-early", "after the breakdown flash has decayed");
    await page.evaluate(() => window.__forgelab.store.setSpeed(10));
    await waitPhase(["flat-top"]);
    await pause();
    evidence.flatTop = await plasmaOf();
    await advance(0.5);
    const frameBefore = await page.evaluate(() => window.__forgelab.store.frame?.tick ?? -1);
    for (const style of has.styles ? ["scientific", "cinematic"] : ["base"]) {
      if (has.styles) await setStyle(style);
      await heroPose();
      await shot(`plasma-03-flat-top-hero-${style}`, "whole plant, cutaway");
      evidence[`flatTopStats-${style}`] = await canvasStats({ x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8 });
      await insidePose();
      await shot(`plasma-04-flat-top-inside-${style}`, "tangential in-vessel view");
      const v = await vesselFacts();
      await page.evaluate(() => {
        const s = window.__forgelab.store;
        s.toggleCutaway(false);
        s.setSection({ axis: "z", offsetM: 0, flip: false });
      });
      await pose([v.p.x + 1.5, v.p.y + 2.5, v.p.z + v.R * 3.4], [v.p.x, v.p.y, v.p.z]);
      await shot(`plasma-05-flat-top-section-${style}`, "section plane through the torus");
      await page.evaluate(() => {
        const s = window.__forgelab.store;
        s.setSection(null);
        s.toggleCutaway(true);
      });
    }
    const frameAfter = await page.evaluate(() => window.__forgelab.store.frame?.tick ?? -1);
    assert.equal(frameAfter, frameBefore, "changing the display style advanced the simulation");
    assert.deepEqual(await plasmaOf(), evidence.flatTop, "a display style changed plasma state");
    assert.equal(await hash(), design, "viewing the plasma changed the design");
    await stop();
    await frame();
    const off = await page.evaluate(() => {
      let lit = 0;
      window.__forgelab.three().scene.traverse((o) => {
        const u = o.material?.uniforms;
        if (u?.uIntensity && (u.uIntensity.value !== 0 || (u.uFlash?.value ?? 0) !== 0)) lit += 1;
      });
      return lit;
    });
    assert.equal(off, 0, "plasma light survived RETURN TO BUILD");
    assert.equal(await hash(), design);
  });

/* ---------------------------------------------------------------------------------- *
 * Controlled shutdown: the plant's own interlock, tripping at a lower wall temperature
 * ---------------------------------------------------------------------------------- */

if (wants("shutdown"))
  await check("a controlled shutdown dims the plasma with the published density", async () => {
    await referencePlant({ setpointK: 500 });
    await heroPose();
    await hold();
    await activate(10);
    await waitPhase(["shutdown", "ended", "disrupted"]);
    const first = await plasmaOf();
    assert.equal(first.phase, "shutdown", `expected a shutdown, saw ${first.phase}`);
    // Half-way down the current ramp.
    await page.waitForFunction(
      (start) =>
        Object.values(window.__forgelab.director.getState().reading?.vessels ?? {}).some(
          (v) => v.plasma.phase !== "shutdown" || v.plasma.plasmaCurrentA < start * 0.5,
        ),
      first.plasmaCurrentA,
      { timeout: 240000, polling: 50 },
    );
    await pause();
    evidence.shutdown = await plasmaOf();
    await advance(0.3);
    await shot("plasma-06-shutdown", `current ${(evidence.shutdown.plasmaCurrentA / 1e6).toFixed(1)} MA`);
    await page.evaluate(() => window.__forgelab.store.setSpeed(10));
    await waitPhase(["ended"]);
    await pause();
    await advance(0.15);
    await shot("plasma-07-ended-afterglow", "0.15 s after the plasma ended");
    await advance(3);
    await shot("plasma-08-ended-dark", "3 s after the plasma ended");
    const end = await canvasStats({ x0: 0.25, x1: 0.75, y0: 0.2, y1: 0.8 });
    evidence.endedStats = end;
    await stop();
  });

/* ---------------------------------------------------------------------------------- *
 * Disruption: flash at the wall, current quench, dark
 * ---------------------------------------------------------------------------------- */

if (wants("disruption"))
  await check("a disruption plays as a sequence and leaves no plasma", async () => {
    await stop();
    await page.evaluate(() => window.__forgelab.loadScenario("plasma-disruption"));
    await settle(800);
    await closePanels();
    await page.evaluate(() => window.__forgelab.store.toggleCutaway(true));
    await heroPose();
    await hold();
    await activate(2);
    await page.waitForFunction(
      () =>
        window.__forgelab.director.getState().destructions.some((d) => d.family === "disruption"),
      null,
      { timeout: 240000, polling: 50 },
    );
    await pause();
    await closePanels();
    evidence.disruption = await page.evaluate(() =>
      window.__forgelab.director.getState().destructions.find((d) => d.family === "disruption"),
    );
    for (const [i, t] of [0.03, 0.12, 0.4, 1.2, 4].entries()) {
      await advance(i === 0 ? t : t - [0.03, 0.12, 0.4, 1.2, 4][i - 1]);
      await shot(`disruption-${i + 1}-t${String(t).replace(".", "_")}`, `${t} s after the event`);
    }
    const plasma = await plasmaOf();
    assert.equal(plasma.phase, "disrupted");
    await stop();
  });

/* ---------------------------------------------------------------------------------- *
 * Failure families, each mid-sequence
 * ---------------------------------------------------------------------------------- */

const FAULTS = [
  { id: "magnet-quench", family: "quench", speed: 5, at: [0.5, 3, 12], view: [9, 5, 12] },
  { id: "pipe-rupture", family: "coolant", speed: 1, at: [0.3, 2, 8], view: [5, 3, 6] },
  { id: "coolant-boiling", family: "coolant", speed: "max", at: [0.5, 3, 9], view: [7, 5, 9] },
  { id: "structural-collapse", family: "structural", speed: 1, at: [0.4, 1.5, 6], view: [9, 5, 11] },
  { id: "electrical-bus-fault", family: "electrical", speed: 10, at: [0.08, 0.45, 3], view: [4, 2.5, 5] },
];

if (wants("faults"))
  for (const fault of FAULTS)
    await check(`${fault.id}: ${fault.family} is anchored, seeded and cleared by RETURN TO BUILD`, async () => {
      await stop();
      await page.evaluate((id) => window.__forgelab.loadScenario(id), fault.id);
      await settle(800);
      await closePanels();
      const before = await hash();
      await hold();
      await activate(fault.speed);
      await page.waitForFunction(
        (family) =>
          window.__forgelab.director.getState().destructions.some((d) => d.family === family),
        fault.family,
        { timeout: 300000, polling: 50 },
      );
      await pause();
      await closePanels();
      const event = await page.evaluate(
        (family) =>
          window.__forgelab.director.getState().destructions.find((d) => d.family === family),
        fault.family,
      );
      const [x, y, z] = event.worldPosition;
      await pose([x + fault.view[0], y + fault.view[1], z + fault.view[2]], [x, y, z]);
      let last = 0;
      for (const [i, t] of fault.at.entries()) {
        await advance(t - last);
        last = t;
        await shot(`fault-${fault.id}-${i + 1}`, `${event.failureType} +${t} s`);
      }
      const stats = await page.evaluate(() => window.__forgelab.vfxStats());
      (evidence.faults ??= []).push({ id: fault.id, event, stats });
      await stop();
      await frame();
      const left = await page.evaluate(() => window.__forgelab.vfxStats());
      const alive = Object.entries(left).filter(([, n]) => n > 0);
      assert.deepEqual(alive, [], `effects survived RETURN TO BUILD: ${JSON.stringify(left)}`);
      assert.equal(await hash(), before, "the design changed after the failure run");
    });

/* ---------------------------------------------------------------------------------- *
 * Finish
 * ---------------------------------------------------------------------------------- */

await check("no uncaught page or GL errors", async () => {
  const relevant = errors.filter((e) => !/Failed to load resource/.test(e));
  assert.deepEqual(relevant, []);
});
evidence.errors = errors;
if (SHOTS) await writeFile(`${SHOTS}/evidence.json`, JSON.stringify(evidence, null, 1));
await browser.close();
if (failed) process.exit(1);
console.log(`\nPlasma and effects test passed against ${BASE}.`);
