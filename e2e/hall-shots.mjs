/**
 * Hall evidence: screenshots (1600 × 900 JPEG) and renderer.info measurements for every
 * hall size and graphics tier, against a production build. Local-only mode is enough.
 *
 *   pnpm vercel-build && node scripts/serve-output.mjs 3000
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium \
 *     E2E_SHOTS=/tmp/hall HALL_LABEL=after node e2e/hall-shots.mjs http://localhost:3000
 *
 * Writes `<label>-<view>.jpg` and `<label>-measurements.json` into E2E_SHOTS. The numbers
 * are draw calls and triangles for one whole frame (shadow pass, reflection pass and
 * post-processing included), read from renderer.info. Software GL: never a frame rate.
 * The script also runs against builds that predate the hall presets (HALL_LABEL=before).
 */
import { mkdir, stat, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] ?? process.env.FORGELAB_URL ?? "http://localhost:3000";
const out = process.env.E2E_SHOTS ?? "/tmp/forgelab-hall";
const label = process.env.HALL_LABEL ?? "after";
const only = process.env.HALL_VIEWS ? new Set(process.env.HALL_VIEWS.split(",")) : null;
const MAX_BYTES = 350 * 1024;
await mkdir(out, { recursive: true });
const t0 = Date.now();
const log = (text) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${text}`);

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

/** Waits until the on-demand renderer has stopped drawing (the view has settled). */
async function settle(maxMs = 45000) {
  const t0 = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - t0 < maxMs) {
    const frame = await page.evaluate(() => window.__forgelab.three().gl.info.render.frame);
    stable = frame === last ? stable + 1 : 0;
    if (stable >= 3) return;
    last = frame;
    await page.waitForTimeout(400);
  }
}

/** Free camera: fly mode switches the orbit controls off, then the pose is set directly. */
async function view(position, target) {
  await page.evaluate(
    ({ position, target }) => {
      const f = window.__forgelab;
      if (f.nav?.teleport) {
        f.nav.teleport(position, target, "fly");
        return;
      }
      f.store.setCameraMode("fly");
      const { camera, invalidate } = f.three();
      camera.position.set(...position);
      camera.lookAt(...target);
      camera.updateMatrixWorld();
      invalidate();
    },
    { position, target },
  );
  await page.waitForTimeout(300);
  // The camera moved: one more frame after React has committed the mode change.
  await page.evaluate(
    ({ position, target }) => {
      const f = window.__forgelab;
      if (f.nav?.teleport) return;
      const { camera, invalidate } = f.three();
      camera.position.set(...position);
      camera.lookAt(...target);
      camera.updateMatrixWorld();
      invalidate();
    },
    { position, target },
  );
  await settle();
}

/** Draw calls and triangles of exactly one frame, everything included. */
async function measure() {
  return page.evaluate(async () => {
    const f = window.__forgelab;
    if (f.renderStats) return f.renderStats();
    const { gl, invalidate } = f.three();
    const info = gl.info;
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        info.autoReset = false;
        info.reset();
        gl.shadowMap.needsUpdate = true;
        invalidate();
        requestAnimationFrame(() => {
          const result = {
            calls: info.render.calls,
            triangles: info.render.triangles,
            lines: info.render.lines,
            points: info.render.points,
            geometries: info.memory.geometries,
            textures: info.memory.textures,
            programs: info.programs?.length ?? 0,
          };
          info.autoReset = true;
          resolve(result);
        });
      });
    });
  });
}

async function shot(name) {
  const path = `${out}/${label}-${name}.jpg`;
  for (const quality of [84, 76, 68, 60, 50, 40]) {
    await page.screenshot({ path, type: "jpeg", quality });
    if ((await stat(path)).size <= MAX_BYTES) break;
  }
  log(`shot ${label}-${name}.jpg (${Math.round((await stat(path)).size / 1024)} kB)`);
}

async function quality(tier) {
  await page.evaluate((tier) => {
    // The same store the Presentation menu writes; read back by the scene on change.
    const key = "forgelab.presentation.v1";
    const current = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...current, quality: tier }));
  }, tier);
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: tier[0] + tier.slice(1).toLowerCase(), exact: true })
    .click();
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
  await page.waitForTimeout(600);
  await settle();
}

async function open() {
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.waitForTimeout(1500);
  await page.addStyleTag({
    content: ".fx-debug,.hints,.viewport__empty,.status-strip{display:none!important}",
  });
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(false));
}

/** Hall sizes this build offers; a build without presets has only today's hall. */
const hallIds = async () =>
  page.evaluate(() => window.__forgelab.hall?.ids?.() ?? ["standard"]);
const setHall = async (id) => {
  await page.evaluate((id) => window.__forgelab.hall?.set?.(id), id);
  await page.waitForTimeout(800);
  await settle();
};
const hallViews = async () =>
  page.evaluate(() => window.__forgelab.hall?.views?.() ?? null);

/** The same cameras as the "before" shots, inside the 140 × 90 m hall. */
const STANDARD_VIEWS = {
  establishing: { position: [64, 27, 41], target: [-12, 7, -10] },
  eye: { position: [34, 1.7, 36], target: [-6, 7, -6] },
  gallery: { position: [67.6, 9.7, 24], target: [10, 5, -14] },
  crane: { position: [-22, 24, 24], target: [-56, 42, -2] },
};

const measurements = { label, base, hall: {}, errors };
try {
  await page.addInitScript(() => {
    if (localStorage.getItem("forgelab.presentation.v1") === null)
      localStorage.setItem(
        "forgelab.presentation.v1",
        JSON.stringify({ quality: "MEDIUM", muted: true, cameraEffectsIntensity: 0 }),
      );
  });
  await open();
  log("builder open");
  const ids = await hallIds();
  for (const id of ids) {
    await setHall(id);
    const views = (await hallViews()) ?? STANDARD_VIEWS;
    const m = (measurements.hall[id] = { empty: {}, plant: {} });
    const wanted = (name) => only === null || only.has(name);

    // Empty hall at every tier: what the building itself costs.
    await page.evaluate(() => window.__forgelab.store.newBlank?.());
    await page.evaluate(() => window.__forgelab.store.openDialog?.(null));
    for (const tier of ["LOW", "MEDIUM", "HIGH", "ULTRA"]) {
      if (!wanted("tiers") && !wanted("measure")) continue;
      await quality(tier);
      await view(views.establishing.position, views.establishing.target);
      m.empty[tier] = await measure();
      log(`${id} empty ${tier}: ${JSON.stringify(m.empty[tier])}`);
      if (wanted("tiers")) await shot(`${id}-tier-${tier.toLowerCase()}`);
    }
    await quality("MEDIUM");

    // The reference machine for scale.
    await page.evaluate(() => window.__forgelab.loadBlueprint("iter-class-plant"));
    await page.waitForTimeout(1500);
    for (const name of ["establishing", "eye", "gallery", "crane"]) {
      const v = views[name];
      if (v === undefined || !wanted(name)) continue;
      await view(v.position, v.target);
      if (name === "establishing") {
        m.plant.MEDIUM = await measure();
        log(`${id} iter-class plant MEDIUM: ${JSON.stringify(m.plant.MEDIUM)}`);
      }
      await shot(`${id}-${name}`);
    }
  }

  // A machine close-up under the hall light (HIGH: reflections and contact shading).
  if (only === null || only.has("machine")) {
    await setHall(ids[0]);
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.newBlank?.();
      s.openDialog?.(null);
      s.addPart("coolant-pump", { x: 0, y: 0, z: 0 });
      s.addPart("steam-turbine", { x: 6, y: 0, z: -3 });
      s.clearSelection();
    });
    await quality("HIGH");
    await view([4.4, 2.3, 5.2], [0.6, 1, -0.6]);
    await shot("machine-high");
    await quality("MEDIUM");
    await view([4.4, 2.3, 5.2], [0.6, 1, -0.6]);
    await shot("machine-medium");
  }
  await writeFile(`${out}/${label}-measurements.json`, JSON.stringify(measurements, null, 2));
  if (errors.length > 0) {
    console.error(`browser errors:\n${errors.join("\n")}`);
    process.exitCode = 1;
  } else console.log("✓ no browser errors");
} finally {
  await browser.close();
}
