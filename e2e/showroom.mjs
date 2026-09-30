/**
 * Showroom browser test: the presentation layer end to end, against a production build.
 *
 *   pnpm vercel-build && node scripts/serve-output.mjs 3000
 *   node e2e/showroom.mjs [http://localhost:3000]
 *
 * Works in local-only mode (no Supabase needed). Uses the builder's `?debug` handle to load
 * the showroom fault scenarios — ordinary designs the simulation runs — and to read
 * presentation state. Every failure asserted here was raised by the simulation.
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.FORGELAB_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? null;

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

let step = 0;
let failed = false;
async function check(name, fn) {
  step += 1;
  const t0 = Date.now();
  try {
    await fn();
    console.log(
      `✓ ${String(step).padStart(2, "0")} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
    );
  } catch (error) {
    failed = true;
    console.error(
      `✗ ${String(step).padStart(2, "0")} ${name}\n  ${error.message.split("\n").join("\n  ")}`,
    );
    if (SHOTS)
      await page.screenshot({ path: `${SHOTS}/showroom-fail-${step}.png` }).catch(() => {});
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
const state = () =>
  page.evaluate(() => {
    const f = window.__forgelab;
    const s = f.director.getState();
    return {
      mode: s.mode,
      facility: s.facility,
      alarm: s.alarm,
      replaying: s.replaying,
      stages: Object.fromEntries(s.stages.map((x) => [x.id, x.status])),
      families: s.destructions.map((d) => d.family),
      t: s.reading?.timeSec ?? 0,
      emitters: f.audio.emitterIds().length,
      level: f.audio.level(),
    };
  });
const vfx = () => page.evaluate(() => window.__forgelab.vfxStats());

async function loadScenario(id) {
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  await page.evaluate((scenario) => window.__forgelab.loadScenario(scenario), id);
  await page.waitForTimeout(600);
}
async function activate(speed) {
  await page.click("button.simulate-btn");
  await page.evaluate((s) => window.__forgelab.store.setSpeed(s), speed);
}
async function waitFor(predicate, arg, timeout = 120000) {
  await page.waitForFunction(predicate, arg, { timeout, polling: 250 });
}

await page.goto(`${BASE}/app?debug`, { waitUntil: "networkidle" });
await page.keyboard.press("Escape");
await page.mouse.click(720, 450); // a gesture, so audio may start

await check("the Main Reactor Hall renders with nothing in it", async () => {
  const s = await state();
  expect(s.mode === "build" && s.facility === "BUILD", `unexpected state ${JSON.stringify(s)}`);
  const hall = await page.evaluate(() => {
    const { scene } = window.__forgelab.three();
    return scene.getObjectByName("main-reactor-hall") !== undefined;
  });
  expect(hall, "no hall in the scene");
  for (let i = 1; i <= 6; i += 1) await page.keyboard.press(`Shift+Digit${i}`);
});

await check(
  "the reference plant activates stage by stage to fusion, with machine sound",
  async () => {
    await page.click('button[aria-label="More actions"]');
    await page.click('[role="menuitem"]:has-text("Load a blueprint")');
    await page.click("text=Reference tokamak plant");
    await page.waitForTimeout(800);
    await activate(2);
    await waitFor(() =>
      window.__forgelab.director
        .getState()
        .stages.some((s) => s.id === "fusion" && s.status === "done"),
    );
    const s = await state();
    for (const stage of [
      "electrical",
      "cooling",
      "cryogenics",
      "vacuum",
      "magnets",
      "fuel",
      "ignition",
      "fusion",
    ])
      expect(s.stages[stage] === "done", `stage ${stage} is ${s.stages[stage]}`);
    expect(s.facility === "RUNNING", `facility ${s.facility}`);
    expect(s.emitters > 0, "no machine sound emitters");
    expect(s.level > 0, "the audio output is silent");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/showroom-running.png` });
  },
);

/** Scenario → the failure family it must show, and the effect that must be visible. */
const SCENARIOS = [
  { id: "magnet-quench", family: "quench", effect: "vapor", speed: 5 },
  { id: "electrical-bus-fault", family: "electrical", effect: "sparks", speed: 10 },
  { id: "coolant-boiling", family: "coolant", effect: "steam", speed: "max" },
  { id: "structural-collapse", family: "structural", effect: "debris (rigid)", speed: 1 },
  { id: "plasma-disruption", family: "disruption", effect: "dust", speed: 2 },
  { id: "cascade", family: "disruption", effect: "dust", speed: "max" },
];
const signatures = new Map();

for (const scenario of SCENARIOS) {
  await check(
    `${scenario.id}: the simulation raises ${scenario.family} and it looks like one`,
    async () => {
      await loadScenario(scenario.id);
      const before = await page.evaluate(() =>
        window.__forgelab.store
          .getView()
          .snapshot.components.map((c) => [c.id, c.state.physical.positionM]),
      );
      await activate(scenario.speed);
      await waitFor(
        (family) =>
          window.__forgelab.director.getState().destructions.some((d) => d.family === family),
        scenario.family,
        180000,
      );
      await page.evaluate(() => window.__forgelab.store.setSpeed(0));
      let stats = {};
      // Software GL renders about one frame a second; give the effect time to appear.
      for (let i = 0; i < 50; i += 1) {
        stats = await vfx();
        if ((stats[scenario.effect] ?? 0) > 0) break;
        await page.waitForTimeout(300);
      }
      expect(
        (stats[scenario.effect] ?? 0) > 0,
        `no ${scenario.effect} on screen: ${JSON.stringify(stats)}`,
      );
      const s = await state();
      expect(
        ["FAILURE", "EMERGENCY", "POST_FAILURE", "POWER_LOSS"].includes(s.facility),
        `facility ${s.facility} after a failure`,
      );
      expect(s.alarm !== "NONE", "no alarm after a failure");
      signatures.set(
        scenario.id,
        Object.keys(stats)
          .filter((k) => stats[k] > 0)
          .sort()
          .join(","),
      );
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/showroom-${scenario.id}.png` });

      if (scenario.id === "magnet-quench") {
        // Failure cinema: replay from before the root cause, then back to the live run.
        await page.click("button:has-text('Watch failure')");
        await page.waitForTimeout(1500);
        const c = await page.evaluate(() => window.__forgelab.cinema.getState());
        expect(
          c.active && c.rootId === "tf-coils",
          `cinema ${JSON.stringify({ active: c.active, root: c.rootId })}`,
        );
        expect((await state()).replaying, "presentation is not showing the replay");
        await page.click("button[aria-label='Exit replay']");
        expect(!(await state()).replaying, "still replaying after exit");

        // The run report names the root failure; Fix it goes back to Build with it selected.
        if ((await page.locator(".report").count()) === 0) await page.click(".report-toggle");
        await page.waitForSelector(".report", { timeout: 10000 });
        const text = await page.locator(".report").innerText();
        expect(/Root failure/.test(text) && text.includes("tf-coils"), `report: ${text}`);
        expect(/measured .* limit/.test(text), "no measured-vs-limit line in the report");
        await page.click(".report button:has-text('Fix it')");
        await page.waitForTimeout(500);
        const after = await page.evaluate(() => {
          const v = window.__forgelab.store.getView();
          return { mode: v.mode, selection: v.selection };
        });
        expect(
          after.mode === "build" && after.selection.join() === "tf-coils",
          `after Fix it: ${JSON.stringify(after)}`,
        );
      }

      // RETURN TO BUILD restores the design exactly as it was before activation.
      await page.evaluate(() => window.__forgelab.store.stopSimulation());
      await page.waitForTimeout(300);
      const after = await page.evaluate(() =>
        window.__forgelab.store
          .getView()
          .snapshot.components.map((c) => [c.id, c.state.physical.positionM]),
      );
      expect(
        JSON.stringify(after) === JSON.stringify(before),
        "the design changed after the failure run",
      );
      const cracks = await page.locator(".screen-cracks").count();
      expect(cracks === 0, "screen cracks survived the return to Build");
    },
  );
}

await check("the six failure scenarios do not all look the same", async () => {
  const distinct = new Set(signatures.values());
  expect(
    distinct.size >= 4,
    `only ${distinct.size} distinct effect sets: ${JSON.stringify([...signatures])}`,
  );
});

await check("no uncaught page errors", async () => {
  const relevant = pageErrors.filter((e) => !/Failed to load resource/.test(e));
  expect(relevant.length === 0, relevant.join("\n"));
});

await browser.close();
if (failed) process.exit(1);
console.log(`\nShowroom test passed against ${BASE}.`);
