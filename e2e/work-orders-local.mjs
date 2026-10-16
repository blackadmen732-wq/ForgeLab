#!/usr/bin/env node
/**
 * Two browser contexts, production work UI and the real migrations in PGlite/Postgres.
 * The local HTTP/SSE fixture replaces Auth/Realtime only; this is NOT a hosted multiplayer
 * or voice test. Run e2e/collaboration.mjs for those services when configured.
 */
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = join(root, "node_modules/.cache");
mkdirSync(cache, { recursive: true });
const temp = mkdtempSync(join(cache, "work-orders-"));
const shots = process.env.E2E_SHOTS ?? "/tmp/forgelab-work-orders-shots";
mkdirSync(shots, { recursive: true });
const { symlinkSync } = await import("node:fs");
// Use a nested tests directory so each invocation has its own migration link.
mkdirSync(join(temp, "tests"));
symlinkSync(join(root, "supabase/migrations"), join(temp, "migrations"));
await build({
  entryPoints: [join(root, "supabase/tests/harness.ts")],
  outfile: join(temp, "tests/db.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const { createTestDatabase, HASH } = await import(pathToFileURL(join(temp, "tests/db.mjs")).href);
const t = await createTestDatabase();
await build({
  entryPoints: [join(root, "e2e/fixtures/work-orders.tsx")],
  outfile: join(temp, "fixture.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  nodePaths: [join(root, "apps/web/node_modules")],
  define: { "import.meta.env": "{}" },
});
const protocol = await build({
  entryPoints: [join(root, "packages/protocol/src/workOrders.ts")],
  write: false,
  bundle: true,
  platform: "node",
  format: "esm",
});
const { parseWorkOrder } = await import(
  `data:text/javascript;base64,${Buffer.from(protocol.outputFiles[0].text).toString("base64")}`
);
const ids = {
  owner: "00000000-0000-4000-8000-0000000000c1",
  member: "00000000-0000-4000-8000-0000000000c2",
  viewer: "00000000-0000-4000-8000-0000000000c3",
  outsider: "00000000-0000-4000-8000-0000000000c4",
};
for (const [name, id] of Object.entries(ids))
  await t.signUp(id, `${name}@local.test`, { username: name });
const project = (
  await t.as(
    ids.owner,
    `insert into public.projects(name,slug) values('Work UI test','work-ui') returning id`,
  )
)[0].id;
await t.as(
  ids.owner,
  `insert into public.project_versions(project_id,schema_version,engine_version,design,design_hash) values($1,2,'0.1.0',$2::jsonb,$3)`,
  [
    project,
    JSON.stringify({
      schemaVersion: 2,
      name: "Work UI",
      components: [{ id: "pump" }],
      connections: [],
    }),
    HASH,
  ],
);
for (const role of ["member", "viewer"])
  await t.as(
    "service",
    `insert into public.project_members(project_id,user_id,role) values($1,$2,$3::public.project_role)`,
    [project, ids[role], role],
  );
const members = Object.entries(ids)
  .filter(([name]) => name !== "outsider")
  .map(([name, id]) => ({
    user_id: id,
    role: name,
    joined_at: new Date().toISOString(),
    profile: {
      username: name,
      display_name: name === "member" ? "Maya" : name === "owner" ? "Project Lead" : "Viewer",
      avatar_path: null,
    },
  }));
const events = new Set();
let queue = Promise.resolve();
const html = `<!doctype html><html><head><meta charset="utf-8"><title>ForgeLab work-order UI check</title><link rel="stylesheet" href="/fixture.css"><style>
.fixture-head{height:70px;display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid #344150}.fixture-head span{font-size:12px;color:#a9b7c8}.fixture-layout{display:grid;grid-template-columns:365px 1fr 340px;height:calc(100vh - 70px)}.fixture-context{padding:48px}.fixture-context h1{font-size:32px}.fixture-context p{margin:18px 0;max-width:440px;color:#a9b7c8}.fixture-inspector{border-left:1px solid #344150;padding:18px 0}.fixture-inspector h2{padding:0 12px;font-size:15px}.readonly-banner{padding:12px;display:flex;gap:12px;align-items:center;background:#172d35}button,input,select,textarea{font:inherit}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.write("data: ready\n\n");
    events.add(res);
    req.on("close", () => events.delete(res));
    return;
  }
  if (!url.pathname.startsWith("/data/")) {
    const file =
      url.pathname === "/fixture.js"
        ? "fixture.js"
        : url.pathname === "/fixture.css"
          ? "fixture.css"
          : null;
    res.writeHead(200, {
      "content-type": file?.endsWith("js") ? "text/javascript" : file ? "text/css" : "text/html",
    });
    res.end(file ? readFileSync(join(temp, file)) : html);
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  queue = queue.then(async () => {
    try {
      const actor = url.searchParams.get("actor");
      if (!Object.hasOwn(ids, actor)) throw new Error("Unknown actor");
      const user = ids[actor];
      const data = body ? JSON.parse(body) : {};
      let result;
      switch (url.pathname) {
        case "/data/initial":
          result = {
            projectId: project,
            userId: user,
            state: {
              role: actor === "outsider" ? null : actor,
              loading: false,
              error: null,
              presenceError: null,
              members,
              channels: [],
              session: {
                status: "connected",
                role: actor,
                self: { workspaceId: "test", focus: null },
                roster: [],
              },
              textChannelId: null,
              messages: [],
              chat: "live",
              chatError: null,
              voice: { phase: "idle", channelId: null, members: [], error: null },
              revision: null,
            },
          };
          break;
        case "/data/list":
          result = (
            await t.as(
              user,
              `select * from public.work_orders where project_id=$1 order by created_at desc`,
              [project],
            )
          ).map((row) => parseWorkOrder(JSON.parse(JSON.stringify(row))));
          break;
        case "/data/create":
          result = parseWorkOrder(
            (
              await t.as(
                user,
                `select to_jsonb(public.create_work_order($1,$2,$3,$4,$5,$6,$7)) as w`,
                [
                  project,
                  data.assignedTo,
                  data.targetComponentId,
                  data.taskType,
                  data.title,
                  data.description,
                  data.priority,
                ],
              )
            )[0].w,
          );
          break;
        case "/data/transition":
          result = parseWorkOrder(
            (
              await t.as(user, `select to_jsonb(public.transition_work_order($1,$2,$3)) as w`, [
                data.id,
                data.from,
                data.status,
              ])
            )[0].w,
          );
          break;
        default:
          throw new Error("Unknown action");
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      if (body) for (const stream of events) stream.write("data: changed\n\n");
    } catch (e) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const errors = [];
const pages = [];
async function open(actor) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  pages.push({ actor, page });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/?actor=${actor}`);
  await page.getByRole("heading", { name: "Team", exact: true }).waitFor();
  return page;
}
try {
  const a = await open("owner");
  const b = await open("member");
  const v = await open("viewer");
  await b.getByRole("button", { name: /^Work ·/ }).click();
  await a.getByRole("button", { name: "Assign Work", exact: true }).click();
  await a.getByLabel("Assign to", { exact: true }).selectOption(ids.member);
  assert.equal(await a.getByLabel("Assign to", { exact: true }).locator("option").count(), 2);
  await a.getByLabel("Work title").fill("Inspect coolant interfaces");
  await a.getByLabel("Work notes").fill("Check inlet, outlet and power. <b>Text only</b>");
  await a.screenshot({ path: join(shots, "work-assignment.png") });
  await a.getByRole("button", { name: "Assign job", exact: true }).click();
  await b.locator(".work__card").getByText("Inspect coolant interfaces", { exact: true }).waitFor();
  await b.getByRole("status").filter({ hasText: "Assigned to you" }).waitFor();
  await b.screenshot({ path: join(shots, "work-received.png") });
  assert.equal(await b.locator(".work__description b").count(), 0);
  await b.getByRole("button", { name: "Accept", exact: true }).click();
  await b.getByRole("button", { name: "Start", exact: true }).click();
  await b.getByRole("button", { name: "Inspect coil instead" }).click();
  await b.locator('[data-testid="focus"]').filter({ hasText: "coil" }).waitFor();
  await b.getByRole("button", { name: /^Go to component ·/ }).click();
  await b.locator('[data-testid="focus"]').filter({ hasText: "pump" }).waitFor();
  await b.getByRole("button", { name: "Mark blocked", exact: true }).click();
  await b.getByRole("button", { name: "Resume", exact: true }).click();
  await b.reload();
  await b.getByRole("button", { name: /^Work ·/ }).click();
  await b.getByRole("button", { name: "Complete", exact: true }).click();
  await b.getByRole("checkbox", { name: "History" }).check();
  await b.locator(".work__card .badge").filter({ hasText: "Completed" }).waitFor();
  await b.screenshot({ path: join(shots, "work-completed.png") });
  await a.getByRole("button", { name: /^Work ·/ }).click();
  await a.getByLabel("Work order filter").selectOption("managed");
  await a.getByRole("checkbox", { name: "History" }).check();
  await a.locator(".work__card .badge").filter({ hasText: "Completed" }).waitFor();
  await v.getByRole("button", { name: /^Work ·/ }).click();
  await v.getByLabel("Work order filter").selectOption("all");
  await v.getByRole("checkbox", { name: "History" }).check();
  await v.locator(".work__card").waitFor();
  assert.equal(await v.getByRole("button", { name: "Assign Work", exact: true }).count(), 0);
  assert.equal(await v.locator(".work__actions button").count(), 0);
  const row = (await (await fetch(`${base}/data/list?actor=owner`)).json())[0];
  const forbidden = await fetch(`${base}/data/transition?actor=viewer`, {
    method: "POST",
    body: JSON.stringify({ id: row.id, from: "completed", status: "accepted" }),
  });
  assert.equal(forbidden.status, 403);
  const outsiders = await (await fetch(`${base}/data/list?actor=outsider`)).json();
  assert.deepEqual(outsiders, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: production Team/Inspector controls in three browser contexts; real SQL assignment, notification, accept/start/block/resume, focus callback, reload persistence, completion/history, viewer/outsider denial. Test HTTP/SSE transport; hosted Supabase/LiveKit untested.",
  );
} catch (error) {
  for (const { actor, page } of pages) {
    await page.screenshot({ path: join(shots, `work-failure-${actor}.png`) });
    console.error(`${actor}: ${await page.locator(".form-error").allTextContents()}`);
  }
  throw error;
} finally {
  await browser.close();
  for (const res of events) res.end();
  await new Promise((resolve) => server.close(resolve));
  await t.close();
  rmSync(temp, { recursive: true, force: true });
}
