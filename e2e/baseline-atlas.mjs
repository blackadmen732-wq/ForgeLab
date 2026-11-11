/**
 * Screenshot atlas of the game as it is: entry page, hall, plant, pump, plasma, cutaway,
 * a failure, the run report, the inspector, presence orbs, walk / fly cameras and the
 * lowest versus highest quality tier. Local-only production build; no cloud keys.
 *
 *   pnpm vercel-build && node scripts/serve-output.mjs 3100 &
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium \
 *     E2E_SHOTS=docs/audit-2026-11-11/shots/baseline node e2e/baseline-atlas.mjs http://localhost:3100
 *
 * Optional: ATLAS_ONLY=name1,name2 runs only those shots. Every shot is a 1600x900 JPEG.
 * A step that fails is logged and skipped so one broken state never hides the others.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3100";
const shots = process.env.E2E_SHOTS ?? "/tmp/forgelab-atlas";
const only = process.env.ATLAS_ONLY ? new Set(process.env.ATLAS_ONLY.split(",")) : null;
await mkdir(shots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const shot = async (name) => {
  await page.screenshot({ path: `${shots}/${name}.jpg`, type: "jpeg", quality: 72 });
  console.log(`shot ${name}`);
};
const step = async (name, fn) => {
  if (only && !only.has(name)) return;
  const t0 = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (e) {
    console.log(`FAIL ${name}: ${String(e.message).split("\n")[0]}`);
  }
};
const fl = (fn, arg) => page.evaluate(fn, arg);
const pose = async (p, t) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(350);
    await fl(({ p, t }) => window.__forgelab.store.requestPose(p, t), { p, t });
    try {
      await page.waitForFunction(
        (p) =>
          window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) <
          0.05,
        p,
        { timeout: 15000 },
      );
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  await page.waitForTimeout(1200); // let the demand-driven frame loop settle
};
const activate = async (speed) => {
  await page.locator("button.simulate-btn").click();
  await page.waitForFunction(
    () =>
      window.__forgelab.store.getView().mode === "simulate" ||
      document.querySelector('[role="dialog"]'),
  );
  const dialog = page.locator('[role="dialog"]:has-text("Preflight")');
  if (await dialog.isVisible().catch(() => false))
    await dialog.getByRole("button", { name: "Activate anyway", exact: true }).click();
  await page.waitForFunction(() => window.__forgelab.store.getView().mode === "simulate");
  await fl((s) => window.__forgelab.store.setSpeed(s), speed);
};
const stopSim = async () => {
  await fl(() => window.__forgelab.store.stopSimulation());
  await page.waitForTimeout(600);
};
const quality = async (name) => {
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.getByRole("button", { name: "Presentation settings", exact: true }).click();
  await page.waitForTimeout(2500);
};

// Entry page (no debug handle needed).
await step("01-entry-landing", async () => {
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await shot("01-entry-landing");
});

// The editor: start dialog, then a blank project.
await step("02-start-dialog", async () => {
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await shot("02-start-dialog");
});

await step("03-empty-hall", async () => {
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await fl(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  await shot("03-empty-hall-default-camera");
  await fl(() => window.__forgelab.store.toggleDrawer(false));
  await pose([53, 8, 33], [-15, 4, -18]);
  await shot("03-empty-hall-wide");
});

// A pump, close up, with the inspector.
await step("05-pump", async () => {
  await fl(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("textbox", { name: "Search parts", exact: true }).fill("Coolant Pump");
  await page
    .locator("button.part")
    .filter({ has: page.locator(".part__name", { hasText: /^Coolant Pump$/ }) })
    .click();
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 1,
  );
  const id = await fl(() => {
    const s = window.__forgelab.store;
    const c = s.getView().snapshot.components[0];
    s.setPosition(c.id, { x: 0, y: 1, z: 0 });
    s.toggleDrawer(false);
    s.clearSelection();
    return c.id;
  });
  await page.waitForTimeout(800);
  await fl((id) => window.__forgelab.store.requestFrame([id]), id);
  await page.waitForTimeout(3000);
  await shot("05-pump-closeup");
  await fl((id) => window.__forgelab.store.select([id]), id);
  await page.waitForTimeout(1500);
  await shot("09-inspector-open");
  await fl(() => window.__forgelab.store.toggleInspect());
  await page.waitForTimeout(1500);
  await shot("09b-inspect-panel-internals");
  await fl(() => {
    const s = window.__forgelab.store;
    s.toggleInspect(false);
  });
});

// Ready-made plants.
await step("04-plants", async () => {
  await fl(() => window.__forgelab.loadBlueprint("reference-plant"));
  await page.waitForTimeout(2500);
  await fl(() => window.__forgelab.store.requestFrame(null));
  await page.waitForTimeout(3000);
  await shot("04-reference-plant-wide");
  await fl(() => window.__forgelab.loadBlueprint("iter-class-building"));
  await page.waitForTimeout(3000);
  await fl(() => window.__forgelab.store.requestFrame(null));
  await page.waitForTimeout(3500);
  await shot("04b-iter-class-building-wide");
  await fl(() => window.__forgelab.loadBlueprint("reference-plant"));
  await page.waitForTimeout(2500);
  await fl(() => window.__forgelab.store.requestFrame(null));
  await page.waitForTimeout(2500);
});

// Presence orbs (preview entries: the same drawing the live roster uses).
await step("10-presence", async () => {
  const comps = await fl(() =>
    window.__forgelab.store.getView().snapshot.components.map((c) => ({
      id: c.id,
      label: c.label ?? c.definitionId ?? c.kind ?? "",
    })),
  );
  console.log(`components: ${comps.length}; sample ${JSON.stringify(comps.slice(0, 6))}`);
  const names = [
    ["Alex", "#3b9bff", "inspecting", false, false, 0],
    ["Maya", "#b06cff", "building", false, true, 0.7],
    ["Chris", "#36d17a", "viewing", true, false, 0],
    ["Andre", "#ffb02e", "building", false, false, 0.2],
    ["Sam", "#ff5ca8", "viewing", true, false, 0],
  ];
  const entries = names.map(([name, color, activity, muted, speaking, level], i) => ({
    userId: `u${i}`,
    name,
    color,
    focus: comps[(i * 3 + 1) % comps.length].id,
    activity,
    muted,
    speaking,
    level,
  }));
  await fl((e) => window.__forgelab.previewPresence(e), entries);
  await page.waitForTimeout(3500);
  await shot("10-presence-orbs-wide");
  await fl((e) => window.__forgelab.store.requestFrame([e[1].focus]), entries);
  await page.waitForTimeout(3500);
  await shot("10b-presence-orbs-near");
  await fl(() => window.__forgelab.previewPresence([]));
});

// Cutaway, section and peel views on the plant.
await step("07-cutaway-section", async () => {
  await fl(() => window.__forgelab.store.requestFrame(null));
  await page.waitForTimeout(2500);
  await fl(() => window.__forgelab.store.toggleCutaway());
  await page.waitForTimeout(2500);
  await shot("07-cutaway");
  await fl(() => window.__forgelab.store.toggleCutaway());
  await page.keyboard.press("l");
  await page.locator(".inspect").waitFor({ timeout: 10000 });
  for (let i = 0; i < 3; i += 1)
    await page.getByRole("button", { name: "Peel off the next layer" }).click();
  await page
    .getByRole("group", { name: "Section plane axis" })
    .getByRole("button", { name: "X" })
    .click();
  await page.waitForTimeout(3000);
  await shot("07b-peel-and-section");
  await fl(() => {
    const s = window.__forgelab.store;
    s.setPeel(0);
    s.setSection(null);
    s.toggleInspect(false);
  });
});

// Walk and fly cameras inside the hall.
await step("11-walk-fly", async () => {
  await fl(() => window.__forgelab.store.requestPose([14, 8, 22], [0, 4, 0]));
  await page.waitForTimeout(2000);
  await fl(() => window.__forgelab.store.setCameraMode("walk"));
  await page.waitForTimeout(2500);
  await shot("11-walk-camera");
  await page.keyboard.down("w");
  await page.waitForTimeout(2500);
  await page.keyboard.up("w");
  await page.waitForTimeout(1500);
  await shot("11b-walk-camera-moved");
  await fl(() => window.__forgelab.store.setCameraMode("fly"));
  await page.waitForTimeout(1500);
  await page.keyboard.down("e");
  await page.waitForTimeout(2000);
  await page.keyboard.up("e");
  await page.waitForTimeout(1500);
  await shot("12-fly-camera");
  await fl(() => window.__forgelab.store.setCameraMode("orbit"));
  await page.waitForTimeout(800);
});

// Quality tiers on the same view.
await step("13-quality", async () => {
  await fl(() => window.__forgelab.store.requestFrame(null));
  await page.waitForTimeout(2500);
  await quality("Low");
  await shot("13-quality-low");
  await quality("Ultra");
  await shot("13b-quality-ultra");
  await quality("High");
});

// Plasma active: the reference plant run to fusion.
await step("06-plasma", async () => {
  await activate(2);
  await page.waitForFunction(
    () =>
      window.__forgelab.director
        .getState()
        .stages.some((s) => s.id === "fusion" && s.status === "done"),
    undefined,
    { timeout: 600000, polling: 500 },
  );
  await page.waitForTimeout(2500);
  await shot("06-plasma-active-director-camera");
  await fl(() => window.__forgelab.store.requestView?.("front"));
  await page.waitForTimeout(3000);
  await shot("06b-plasma-active-front");
  await stopSim();
});

// A failure mid-sequence, then the run report.
await step("08-failure-and-report", async () => {
  await fl(() => window.__forgelab.loadScenario("pipe-rupture"));
  await page.waitForTimeout(1500);
  await activate(1);
  await page.waitForFunction(
    () => window.__forgelab.store.getSim().failures.length > 0,
    undefined,
    { timeout: 300000, polling: 250 },
  );
  await page.waitForTimeout(2500);
  await shot("08-failure-mid-sequence");
  await page.waitForTimeout(6000);
  await shot("08b-failure-later");
  await page.waitForFunction(
    () => window.__forgelab.director.getState().runEnded === true,
    undefined,
    { timeout: 300000, polling: 500 },
  ).catch(() => {});
  const toggle = page.locator("button.report-toggle");
  const dialog = page.locator('[role="dialog"][aria-label="Run report"]');
  if (!(await dialog.isVisible().catch(() => false)))
    await toggle.click({ timeout: 10000 }).catch(() => {});
  await dialog.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot("08c-run-report");
});

const relevant = errors.filter((e) => !/Failed to load resource/.test(e));
console.log(`page errors: ${relevant.length}`);
for (const e of relevant.slice(0, 8)) console.log(`  ${e.slice(0, 200)}`);
await browser.close();
