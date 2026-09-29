#!/usr/bin/env node
/**
 * ForgeLab V0.1 acceptance test — the full loop in a real browser against a real
 * Supabase stack and the production build:
 *
 *   guest → build → simulate → fail → fix → create account → cloud save → autosave
 *   → reload → publish → submit score (server verifies) → leaderboard
 *   → second user forks → lineage and discover
 *
 * Prerequisites (see docs/DEPLOYMENT.md, "Local end-to-end"):
 *   supabase start                         (local stack with this repo's migrations)
 *   pnpm vercel-build with VITE_SUPABASE_* pointing at it
 *   node scripts/serve-output.mjs 3000     with SUPABASE_URL / SUPABASE_SECRET_KEY
 *
 *   node e2e/acceptance.mjs [baseUrl]      (default http://localhost:3000)
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.FORGELAB_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? null;
const stamp = Date.now().toString(36);
const users = [
  { username: `ada_${stamp}`, email: `ada_${stamp}@example.com`, password: "correct-horse-1" },
  { username: `bob_${stamp}`, email: `bob_${stamp}@example.com`, password: "correct-horse-2" },
];

let step = 0;
async function check(name, fn) {
  step += 1;
  const started = Date.now();
  try {
    await fn();
    console.log(
      `✓ ${String(step).padStart(2, "0")} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
    );
  } catch (error) {
    console.error(
      `✗ ${String(step).padStart(2, "0")} ${name}\n  ${error instanceof Error ? error.message : error}`,
    );
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/fail-${step}.png` }).catch(() => {});
    await browser.close();
    process.exit(1);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

const text = (selector) => page.locator(selector).first().innerText();
const sim = async (speed = "Max") => {
  await page.click("button.simulate-btn");
  await page.click(`.segmented--sm button:has-text("${speed}")`);
};
const stop = () => page.click("button.simulate-btn:has-text('STOP')");
const signUp = async (user) => {
  await page.waitForSelector('[role="dialog"]:has-text("Sign in")');
  await page.click("text=Create an account");
  await page.fill('input[autocomplete="username"]', user.username);
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]:has-text("Create account")');
};
/** The save badge reads exactly "Saved…" (not "Unsaved changes"). */
const waitSaved = (timeout = 20000) =>
  page.waitForFunction(
    () => /^Saved/.test(document.querySelector(".save-status")?.textContent?.trim() ?? ""),
    null,
    { timeout },
  );
let projectId = "";
let forkId = "";

await check("guest opens the builder with an empty workspace offer", async () => {
  await page.goto(`${BASE}/app?new=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Start building");
  expect(await page.isVisible("text=Blank project"), "no blank-project option");
});

await check("loads the interactive starter", async () => {
  await page.click("text=Interactive starter");
  await page.waitForSelector('.insp-row:has-text("Parts") >> text=16');
});

await check("simulates and the plant fails with an explained cause", async () => {
  await sim();
  await page.waitForSelector('.failure:has-text("lost flow")', { timeout: 30000 });
  await page.click('.failure button[aria-label="Why?"]');
  expect(
    (await text(".failure__detail")).includes("switched off"),
    "cause does not name the switched-off pump",
  );
});

await check("fixes it: enables the pump in Build mode", async () => {
  await stop();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Go to Primary Pump");
  await page.keyboard.press("Enter");
  await page.waitForSelector('.insp-head__label[value="Primary Pump"]');
  await page.click('.insp-row:has-text("Enabled") .switch');
});

await check("re-runs without loss of flow and produces gross electric power", async () => {
  await sim();
  await page.waitForFunction(
    () => {
      const clock = document.querySelector(".timeline__clock")?.textContent ?? "";
      return clock >= "01:00";
    },
    null,
    { timeout: 60000 },
  );
  const failures = await page.locator('.failure:has-text("lost flow")').count();
  expect(failures === 0, "loss of flow still reported");
  const gross = await text('.timeline__kpis span:has-text("Gross") strong');
  expect(parseFloat(gross) > 0, `gross electric is ${gross}`);
  await stop();
});

await check("Save asks a guest to sign in; sign-up completes the save to the cloud", async () => {
  await page.click('button:has-text("Save")');
  await signUp(users[0]);
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/, { timeout: 20000 });
  projectId = page.url().split("/").pop();
  await waitSaved();
});

await check("edits autosave to the cloud", async () => {
  await page.click(".topbar__name");
  await page.fill(".topbar__name-input", "Ada's First Plant");
  await page.keyboard.press("Enter");
  await page.waitForSelector('.topbar__name:has-text("Ada\'s First Plant")', { timeout: 5000 });
  await page.waitForFunction(
    () =>
      /^(Unsaved|Saving)/.test(document.querySelector(".save-status")?.textContent?.trim() ?? ""),
    null,
    { timeout: 5000 },
  );
  await waitSaved();
});

await check("reload restores the design from the cloud", async () => {
  await page.goto(`${BASE}/app/${projectId}`, { waitUntil: "networkidle" });
  await page.waitForSelector('.topbar__name:has-text("Ada\'s First Plant")', { timeout: 20000 });
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Go to Primary Pump");
  await page.keyboard.press("Enter");
  expect(await page.isChecked('.insp-row:has-text("Enabled") input'), "pump fix was not saved");
});

await check("publishes with a thumbnail", async () => {
  await page.click('button:has-text("Publish")');
  await page.waitForSelector('[role="dialog"]:has-text("Publish design")');
  await page.waitForSelector(".publish__thumb img", { timeout: 10000 });
  await page.fill(".publish textarea", "The starter plant, pump fixed.");
  await page.click('[role="dialog"] button:has-text("Publish")');
  await page.waitForSelector('[role="dialog"]:has-text("Update public page")', { timeout: 20000 });
  await page.keyboard.press("Escape");
});

await check("submits a score that the server recomputes", async () => {
  await page.click('button[aria-label="More actions"]');
  await page.click('[role="menuitem"]:has-text("Submit score")');
  await page.click('button:has-text("Submit for verification")');
  await page.waitForSelector("text=Server-verified", { timeout: 90000 });
  expect((await text('[role="dialog"]')).includes("Fusion gain"), "no fusion-gain row");
  await page.keyboard.press("Escape");
});

await check("the verified entry is on the leaderboard", async () => {
  await page.goto(`${BASE}/leaderboards?category=fusion-gain`, { waitUntil: "networkidle" });
  await page.waitForSelector(`table >> text=${users[0].username}`, { timeout: 15000 });
});

await check("the public page shows the design and its verified results", async () => {
  await page.goto(`${BASE}/project/${projectId}`, { waitUntil: "networkidle" });
  await page.waitForSelector('h1:has-text("Ada\'s First Plant")');
  await page.waitForSelector("text=Verified results");
  expect((await page.locator(".project table tbody tr").count()) >= 1, "no verified rows");
});

await check("a second engineer signs up and forks it", async () => {
  await page.click('button[aria-label="Account menu"]');
  await page.click('[role="menuitem"]:has-text("Sign out")');
  await page.waitForSelector('button:has-text("Sign in")');
  await page.click('.project button:has-text("Fork")');
  await signUp(users[1]);
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/, { timeout: 20000 });
  forkId = page.url().split("/").pop();
  expect(forkId !== projectId, "fork has the original's id");
  await page.waitForSelector(".topbar__name:has-text('(fork)')", { timeout: 20000 });
});

await check("lineage and counts are recorded", async () => {
  await page.goto(`${BASE}/project/${projectId}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=1 forks");
  await page.goto(`${BASE}/app/${forkId}`, { waitUntil: "networkidle" });
  await waitSaved();
});

await check("discover lists the published design", async () => {
  await page.goto(`${BASE}/discover?sort=newest`, { waitUntil: "networkidle" });
  await page.waitForSelector('.card:has-text("Ada\'s First Plant")', { timeout: 15000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/discover.png` });
});

await check("a guest cannot see private projects", async () => {
  await page.click('button[aria-label="Account menu"]');
  await page.click('[role="menuitem"]:has-text("Sign out")');
  await page.goto(`${BASE}/project/${forkId}`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Nothing at this address");
});

const serious = pageErrors.filter(
  (e) => !/Failed to load resource: the server responded with a status of (401|404)/.test(e),
);
await check("no uncaught page errors", async () => {
  expect(serious.length === 0, serious.join("\n"));
});

await browser.close();
console.log(`\nAcceptance test passed against ${BASE}.`);
