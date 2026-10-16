/** Actual production editor routing, including blocked links, undo and persistence. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const base = process.argv[2] ?? "http://localhost:3000";
const before = process.argv.includes("--before");
const shots = process.env.E2E_SHOTS ?? "/tmp/forgelab-service-clearance";
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(90000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${shots}/service-${name}.png` });
try {
  await page.addInitScript(() =>
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({ quality: "MEDIUM", bloom: false, haze: false, muted: true }),
    ),
  );
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  const ids = await page.evaluate(() => {
    const s = window.__forgelab.store;
    const source = s.addPart("grid-connection", { x: -8, y: 0, z: 0 });
    const target = s.addPart("coolant-pump", { x: 8, y: 0, z: 0 });
    s.moveComponents(
      [
        {
          id: target,
          position: { x: 8, y: 1, z: 0 },
          rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
        },
      ],
      true,
    );
    const block = s.addPart("equipment-block", { x: 0, y: 0, z: 0 });
    s.setDimension(block, "sizeM", 3);
    s.setLabel(block, "Solid obstruction");
    s.pickSocket({ componentId: source, connectionPointId: "power" });
    s.pickSocket({ componentId: target, connectionPointId: "power" });
    s.clearSelection();
    s.requestPose([13, 8, 15], [0, 1, 0]);
    return { source, target, block, link: s.world.listConnections()[0]?.id };
  });
  assert.ok(ids.link, "compatible endpoint link was not created");
  await page.waitForFunction(
    () => window.__forgelab.three().camera.position.distanceTo({ x: 13, y: 8, z: 15 }) < 0.01,
  );
  await page.waitForTimeout(500);
  await shot(before ? "before-clipping" : "after-clear-route");
  if (!before) {
    const clear = await page.evaluate(() => window.__forgelab.store.getView().serviceRoutes);
    assert.equal(clear.length, 1);
    assert.equal(clear[0].state, "clear");
    assert.ok(
      clear[0].points.some((p) => p[1] > 3.1 || Math.abs(p[2]) > 1.6),
      "route did not clear solid obstruction",
    );
    assert.equal(await page.getByTestId("route-warning").count(), 0);
    const saved = await page.evaluate(() => window.__forgelab.store.exportFile());
    const hash = await page.evaluate(() => window.__forgelab.store.designHash());
    await page.evaluate((id) => {
      const s = window.__forgelab.store,
        c = s.world.requireComponent(id);
      s.moveComponents(
        [{ id, position: { x: -6.8, y: 1.5, z: 0 }, rotation: c.transform.rotation }],
        true,
      );
      s.clearSelection();
    }, ids.block);
    await page.getByTestId("route-warning").waitFor();
    await page.getByTestId("route-warning").locator("summary").click();
    await page.waitForFunction(
      (id) => !!window.__forgelab.three().scene.getObjectByName(`blocked-service:${id}`),
      ids.link,
    );
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.getView().serviceRoutes[0].state),
      "blocked",
    );
    await shot("blocked-guide");
    // Hidden objects continue occupying space. Hiding is not a physical deletion.
    await page.evaluate((id) => {
      const s = window.__forgelab.store;
      s.select([id]);
      s.hideSelected();
    }, ids.block);
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.getView().serviceRoutes[0].state),
      "blocked",
    );
    await page.evaluate(() => window.__forgelab.store.undo());
    assert.equal(await page.evaluate(() => window.__forgelab.store.designHash()), hash);
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.getView().serviceRoutes[0].state),
      "clear",
    );
    await page.evaluate((file) => window.__forgelab.store.loadFile(file), saved);
    assert.deepEqual(
      await page.evaluate(() => window.__forgelab.store.getView().serviceRoutes),
      clear,
    );
    // Actual editor connect actions cannot silently add an impossible new service.
    await page.evaluate(({ block, link }) => {
      const s = window.__forgelab.store,
        c = s.world.requireComponent(block);
      s.moveComponents(
        [{ id: block, position: { x: -6.8, y: 1.5, z: 0 }, rotation: c.transform.rotation }],
        true,
      );
      s.disconnect(link);
    }, ids);
    const rejectedHash = await page.evaluate(() => window.__forgelab.store.designHash());
    await page.evaluate(({ source, target }) => {
      const s = window.__forgelab.store;
      s.pickSocket({ componentId: source, connectionPointId: "power" });
      s.pickSocket({ componentId: target, connectionPointId: "power" });
    }, ids);
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.listConnections().length),
      0,
    );
    assert.equal(await page.evaluate(() => window.__forgelab.store.designHash()), rejectedHash);
    await page.getByText(/No clear electrical route found/).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: actual editor detours around solid machinery; moving a blocker revalidates the route and renders an explicit dashed guide; hidden solids remain obstacles; undo and save/load restore routes; impossible new connection is rejected transactionally; no page errors.",
    );
  } else console.log("Captured the previous fixed-height route before the clearance change.");
} catch (error) {
  await shot("failure");
  throw error;
} finally {
  await browser.close();
}
