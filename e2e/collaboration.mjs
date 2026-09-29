#!/usr/bin/env node
/**
 * ForgeLab collaboration test — two real browsers, a real Supabase stack (Postgres, Auth,
 * Realtime), a real LiveKit SFU and the production build:
 *
 *   owner saves a project → invites a member by link → presence → text chat with a
 *   component reference → a new channel reaches everyone → both join voice in General
 *   (speaking, mute, deafen) → switching channels changes who hears whom → a teammate's
 *   save is announced → a stale save is caught as a conflict → removal ends voice and
 *   access → presence clears.
 *
 * Prerequisites (docs/COMMUNICATIONS.md, "Local end-to-end"): the acceptance-test setup,
 * plus a LiveKit server (livekit-server --dev) with LIVEKIT_* and FORGELAB_PRESENCE_KEY set
 * for the build and the local server.
 *
 *   node e2e/collaboration.mjs [baseUrl]      (default http://localhost:3000)
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? process.env.FORGELAB_URL ?? "http://localhost:3000";
const SHOTS = process.env.E2E_SHOTS ?? null;
const stamp = Date.now().toString(36);
const mark = {
  username: `mark_${stamp}`,
  email: `mark_${stamp}@example.com`,
  password: "correct-horse-3",
};
const andre = {
  username: `andre_${stamp}`,
  email: `andre_${stamp}@example.com`,
  password: "correct-horse-4",
};

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    // A synthetic microphone (a periodic tone) and no permission prompt.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const errors = [];
async function open(name) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${name} console: ${m.text()}`);
  });
  return { context, page };
}
const A = await open("mark");
const B = await open("andre");

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
    if (SHOTS) {
      await A.page.screenshot({ path: `${SHOTS}/collab-fail-${step}-mark.png` }).catch(() => {});
      await B.page.screenshot({ path: `${SHOTS}/collab-fail-${step}-andre.png` }).catch(() => {});
    }
    if (errors.length > 0) console.error(errors.join("\n"));
    await browser.close();
    process.exit(1);
  }
}
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const signUp = async (page, user) => {
  await page.waitForSelector('[role="dialog"]');
  if (await page.isVisible('[role="dialog"] >> text=Create an account'))
    await page.click('[role="dialog"] >> text=Create an account');
  await page.fill('input[autocomplete="username"]', user.username);
  await page.fill('input[type="email"]', user.email);
  await page.fill('input[type="password"]', user.password);
  await page.click('button[type="submit"]:has-text("Create account")');
};
const saveStatus = (page) => page.locator(".save-status").first().innerText();
const waitStatus = (page, pattern, timeout = 20000) =>
  page.waitForFunction(
    (source) =>
      new RegExp(source).test(document.querySelector(".save-status")?.textContent?.trim() ?? ""),
    pattern.source,
    { timeout },
  );
const rename = async (page, name) => {
  await page.click(".topbar__name");
  await page.fill(".topbar__name-input", name);
  await page.keyboard.press("Enter");
};
const online = (page, n) =>
  page.waitForSelector(`.team__head >> text=${n} online`, { timeout: 20000 });
const voiceCount = (page, n) =>
  page.waitForSelector(`.voicebar >> text=${n} connected`, { timeout: 30000 });
let projectId = "";
let inviteLink = "";

await check("owner builds and saves a cloud project", async () => {
  const { page } = A;
  await page.goto(`${BASE}/app?new=1`, { waitUntil: "networkidle" });
  await page.click("text=Interactive starter");
  await page.click('button:has-text("Save")');
  await signUp(page, mark);
  await page.waitForURL(/\/app\/[0-9a-f-]{36}$/, { timeout: 20000 });
  projectId = page.url().split("/").pop();
  await waitStatus(page, /^Saved/);
});

await check("the project has a General channel and the owner is online", async () => {
  const { page } = A;
  await page.click('.topbar button:has-text("Team")');
  await page.waitForSelector('.channel__name:has-text("General")');
  await online(page, 1);
  await page.waitForSelector(`.member.is-online:has-text("${mark.username}") >> text=Owner`);
});

await check("the owner creates a member invite link", async () => {
  const { page } = A;
  await page.click('button[aria-label="Members, invites and channels"]');
  await page.click('[role="tab"]:has-text("Invite")');
  await page.click('button:has-text("Create invite link")');
  inviteLink = await page.inputValue('input[aria-label="Invite link"]');
  expect(/\/invite#[0-9a-f]{64}$/.test(inviteLink), `unexpected invite link ${inviteLink}`);
  await page.keyboard.press("Escape");
});

await check("a second engineer accepts the invite and both see each other online", async () => {
  const { page } = B;
  await page.goto(inviteLink, { waitUntil: "networkidle" });
  await page.click('.empty button:has-text("Create account")');
  await signUp(page, andre);
  await page.waitForURL(new RegExp(`/app/${projectId}`), { timeout: 30000 });
  await page.waitForSelector('.channel__name:has-text("General")', { timeout: 20000 });
  await online(page, 2);
  await online(A.page, 2);
  await A.page.waitForSelector(`.member.is-online:has-text("${andre.username}") >> text=Member`);
  expect(/Saved/.test(await saveStatus(page)), "a member should be able to edit and save");
});

await check("chat reaches the other member live, and a component mention is a link", async () => {
  await B.page.fill('textarea[aria-label="Message #General"]', "Check @pump — flow looks low");
  await B.page.keyboard.press("Enter");
  const message = A.page.locator('.message:has-text("flow looks low")');
  await message.waitFor({ timeout: 15000 });
  expect((await message.innerText()).includes(andre.username), "author not shown");
  await message.locator('.message__ref:has-text("@pump")').click();
  await A.page.waitForSelector('.insp-head__label[value="Primary Pump"]', { timeout: 5000 });
});

await check("chat is plain text: markup is shown, never rendered", async () => {
  await A.page.fill(
    'textarea[aria-label="Message #General"]',
    '<img src=x onerror="window.pwned=1"> <b>bold</b>',
  );
  await A.page.keyboard.press("Enter");
  await B.page.waitForSelector('.message:has-text("<b>bold</b>")', { timeout: 15000 });
  expect(
    (await B.page.locator(".message__body img, .message__body b").count()) === 0,
    "markup rendered",
  );
  expect(!(await B.page.evaluate(() => "pwned" in window)), "script ran");
});

await check("a new channel appears for everyone without reloading", async () => {
  const { page } = A;
  await page.click('button[aria-label="Members, invites and channels"]');
  await page.click('[role="tab"]:has-text("Channels")');
  await page.fill('input[aria-label="New channel name"]', "Reactor Team");
  await page.click('button:has-text("Create channel")');
  await page.waitForSelector(".manage >> text=Reactor Team");
  await page.keyboard.press("Escape");
  await B.page.waitForSelector('.channel__name:has-text("Reactor Team")', { timeout: 15000 });
});

await check("both join voice in General: connected, and speaking is shown", async () => {
  await A.page.click('button[aria-label="Join voice in General"]');
  await voiceCount(A.page, 1);
  await B.page.click('button[aria-label="Join voice in General"]');
  await voiceCount(B.page, 2);
  await voiceCount(A.page, 2);
  await A.page.waitForSelector(".voicebar__channel:has-text('GENERAL')");
  // The synthetic microphone beeps; the SFU reports Andre as an active speaker.
  await A.page.waitForSelector(`.voicebar__member.is-speaking[data-tip^="${andre.username}"]`, {
    timeout: 30000,
  });
  // Presence shows who is in which channel, to everyone in the project.
  await A.page.waitForSelector(`.channel__voice >> text=${andre.username}`, { timeout: 15000 });
});

await check("mute and deafen show up for the other member", async () => {
  await B.page.click('.voicebar button[aria-label="Mute"]');
  await A.page.waitForSelector(`.voicebar__member[data-tip="${andre.username} · muted"]`, {
    timeout: 15000,
  });
  await B.page.click('.voicebar button[aria-label="Unmute"]');
  await B.page.click('.voicebar button[aria-label="Deafen"]');
  expect(
    (await B.page.getAttribute('.voicebar button[aria-label="Undeafen"]', "aria-pressed")) ===
      "true",
    "deafen not shown as pressed",
  );
  await A.page.waitForSelector(`.voicebar__member[data-tip="${andre.username} · muted"]`, {
    timeout: 15000,
  });
  await B.page.click('.voicebar button[aria-label="Undeafen"]');
  await A.page.waitForSelector(`.voicebar__member[data-tip="${andre.username}"]`, {
    timeout: 15000,
  });
});

await check("voice is by channel: moving to Reactor Team leaves General's room", async () => {
  await B.page.click('button[aria-label="Join voice in Reactor Team"]');
  await B.page.waitForSelector(".voicebar__channel:has-text('REACTOR TEAM')", { timeout: 15000 });
  await voiceCount(B.page, 1);
  await voiceCount(A.page, 1);
  await A.page.waitForSelector(
    `.channel:has(.channel__name:has-text("Reactor Team")) .channel__voice >> text=${andre.username}`,
    { timeout: 15000 },
  );
  await B.page.click('.voicebar button[aria-label="Leave voice"]');
  await B.page.waitForSelector(".voicebar", { state: "detached", timeout: 10000 });
});

await check("a teammate's save is announced, and loading it is one click", async () => {
  await rename(A.page, "Shared Plant");
  await waitStatus(A.page, /^Saved/);
  await B.page.waitForSelector(
    `.collab-banner:has-text("${mark.username}") >> text=saved version`,
    {
      timeout: 15000,
    },
  );
  await B.page.click('.collab-banner button:has-text("Load it")');
  await B.page.waitForSelector('.topbar__name:has-text("Shared Plant")', { timeout: 15000 });
  await waitStatus(B.page, /^Saved/);
});

await check("a stale save is caught as a conflict, and nothing is overwritten", async () => {
  const before = errors.length;
  await B.context.setOffline(true);
  await rename(B.page, "Andre's Variant");
  await waitStatus(B.page, /^Offline/, 10000);
  await rename(A.page, "Mark's Variant");
  await waitStatus(A.page, /^Saved/);
  await B.context.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await B.page.waitForSelector(".collab-banner--conflict", { timeout: 20000 });
  expect(/Newer version/.test(await saveStatus(B.page)), "status does not show the conflict");
  await B.page.click('.collab-banner button:has-text("Keep mine")');
  await waitStatus(B.page, /^Saved/);
  await A.page.waitForSelector(`.collab-banner:has-text("${andre.username}")`, { timeout: 15000 });
  // The refused stale save is an HTTP 400 by design; the browser logs it.
  const expected = errors.splice(before).filter((e) => !/status of 400/.test(e));
  errors.push(...expected);
});

await check("removing a member ends their voice session and their access", async () => {
  await B.page.click('button[aria-label="Join voice in General"]');
  await voiceCount(B.page, 2); // Mark is still in General
  await A.page.click('button[aria-label="Members, invites and channels"]');
  await A.page.click(`button[aria-label="Remove ${andre.username}"]`);
  await A.page.click('[role="dialog"] button:has-text("Remove")');
  await A.page.waitForSelector(`text=${andre.username} removed`, { timeout: 15000 });
  await A.page.keyboard.press("Escape");
  await B.page.waitForSelector(".voicebar", { state: "detached", timeout: 20000 });
  await B.page.waitForSelector("text=You no longer have access to this project", {
    timeout: 20000,
  });
  await waitStatus(B.page, /^Viewing/, 20000);
  await online(A.page, 1);
});

await check("closing the tab clears presence", async () => {
  // Re-invite Andre, then close his tab.
  await A.page.click('button[aria-label="Members, invites and channels"]');
  await A.page.click('[role="tab"]:has-text("Invite")');
  await A.page.click('button:has-text("Create invite link")');
  const link = await A.page.inputValue('input[aria-label="Invite link"]');
  await A.page.keyboard.press("Escape");
  await B.page.goto(link, { waitUntil: "networkidle" });
  await B.page.waitForURL(new RegExp(`/app/${projectId}`), { timeout: 30000 });
  await online(A.page, 2);
  await B.page.close();
  await online(A.page, 1);
});

await check("no uncaught page errors", async () => {
  expect(errors.length === 0, `page errors:\n${errors.join("\n")}`);
});

await browser.close();
console.log(`\nCollaboration test passed against ${BASE}.`);
