/** Phase A: the procedural pump in the actual editor. Local-only production build.
 * pnpm vercel-build && node scripts/serve-output.mjs 3000
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium E2E_SHOTS=/tmp/pump node e2e/pump.mjs
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
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
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/pump-${name}.png` });
};
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const ready = () => page.waitForFunction(() => window.__forgelab?.three);
const pose = async (position = [4.2, 2.8, 4.8], target = [0, 1, 0]) => {
  await page.evaluate(({ p, t }) => window.__forgelab.store.requestPose(p, t), {
    p: position,
    t: target,
  });
  await page.waitForFunction(
    (p) =>
      window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) < 0.01,
    position,
  );
};
const geometries = () => page.evaluate(() => window.__forgelab.three().gl.info.memory.geometries);
const activate = async () => {
  await page.locator("button.simulate-btn").click();
  await page.waitForFunction(
    () =>
      window.__forgelab.store.getView().mode === "simulate" ||
      document.querySelector('[role="dialog"]') !== null,
  );
  const dialog = page.locator('[role="dialog"]:has-text("Preflight")');
  if (await dialog.isVisible())
    await dialog.getByRole("button", { name: "Activate anyway", exact: true }).click();
  await page.waitForFunction(() => window.__forgelab.store.getView().mode === "simulate");
};

try {
  await page.addInitScript(() =>
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({ quality: "MEDIUM", bloom: false, haze: false, muted: true }),
    ),
  );
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  // Opening New strips the query string, so navigate back with debug to expose the test handle.
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await ready();
  await page.addStyleTag({ content: ".fx-debug {display:none!important;}" });
  assert.equal(
    await page.evaluate(() => window.__forgelab.store.getView().snapshot.components.length),
    0,
  );
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("textbox", { name: "Search parts", exact: true }).fill("Coolant Pump");
  await page.locator("button.part").filter({ hasText: "Coolant Pump" }).click();
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 1,
  );
  const id = await page.evaluate(() => window.__forgelab.store.getView().snapshot.components[0].id);
  await pose();
  await page.mouse.move(650, 70);
  await shot("selected");
  const specs = await page.evaluate(() => {
    const c = window.__forgelab.store.getView().snapshot.components[0];
    return {
      geometry: c.geometry,
      position: c.transform.positionM,
      ports: c.connectionPoints.map((p) => ({
        id: p.id,
        at: p.localPosition,
        type: p.connectionType,
      })),
    };
  });
  assert.deepEqual(specs.geometry.sizeM, { x: 2, y: 2, z: 2 });
  assert.equal(specs.position.y, 1);
  assert.deepEqual(
    specs.ports.map((p) => p.id),
    ["base", "inlet", "outlet", "power", "control"],
  );
  console.log("✓ pump placed from the existing drawer at its real 2 m scale");

  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.toggleDrawer(false);
    s.clearSelection();
  });
  await pose([3.8, 2.5, 4.5]);
  await shot("hero");
  const pick = await page.evaluate(() => {
    const { camera, gl } = window.__forgelab.three();
    const p = camera.position.clone().set(0, 1.52, 0.4).project(camera);
    const r = gl.domElement.getBoundingClientRect();
    return { x: r.x + ((p.x + 1) * r.width) / 2, y: r.y + ((1 - p.y) * r.height) / 2 };
  });
  await page.mouse.click(pick.x, pick.y);
  await page.waitForFunction((id) => window.__forgelab.store.getView().selection.includes(id), id);
  console.log("✓ the visible machine can be picked in the viewport");

  await page.evaluate(() => window.__forgelab.store.setTool("connect"));
  await page.waitForFunction(() => {
    let count = 0;
    window.__forgelab.three().scene.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.type === "SphereGeometry" && o.material.opacity === 0.95)
        count = o.count;
    });
    return count === 5;
  });
  const sockets = await page.evaluate(() => {
    const f = window.__forgelab;
    let socketMesh;
    f.three().scene.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.type === "SphereGeometry" && o.material.opacity === 0.95)
        socketMesh = o;
    });
    if (!socketMesh) return [];
    const m = f.three().camera.matrixWorld.clone();
    return Array.from({ length: socketMesh.count }, (_, i) => {
      socketMesh.getMatrixAt(i, m);
      return m.elements.slice(12, 15);
    });
  });
  assert.equal(sockets.length, 5);
  for (let i = 0; i < 5; i++) {
    const p = specs.ports[i].at;
    const expected = [p.x + specs.position.x, p.y + specs.position.y, p.z + specs.position.z];
    for (let j = 0; j < 3; j++)
      assert(
        Math.abs(sockets[i][j] - expected[j]) < 1e-5,
        JSON.stringify({ socket: specs.ports[i].id, actual: sockets[i], expected }),
      );
  }
  await shot("ports");
  console.log("✓ all five socket overlays match the authoritative interface positions");

  const original = await hash();
  await page.evaluate((id) => {
    const s = window.__forgelab.store;
    s.setTool("move");
    s.setPosition(id, { x: 3, y: 1, z: 0 });
    s.setRotationEuler(id, { x: 0, y: 90, z: 0 });
  }, id);
  assert.notEqual(await hash(), original);
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.undo();
    s.undo();
  });
  assert.equal(await hash(), original);
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.redo();
    s.redo();
  });
  assert.notEqual(await hash(), original);
  const saved = await page.evaluate(() => window.__forgelab.store.exportFile());
  const savedHash = await hash();
  await page.evaluate((file) => window.__forgelab.store.loadFile(file), saved);
  assert.equal(await hash(), savedHash);
  await page.waitForTimeout(1500);
  await page.goto(`${base}/app?debug&draft=1`, { waitUntil: "networkidle" });
  await ready();
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 1,
  );
  assert.equal(await hash(), savedHash);
  console.log("✓ move/rotate, undo/redo, serialization and browser draft restoration");

  await page.addStyleTag({ content: ".fx-debug {display:none!important;}" });
  await page.evaluate((id) => {
    const s = window.__forgelab.store;
    s.setPosition(id, { x: 0, y: 1, z: 0 });
    s.setRotationEuler(id, { x: 0, y: 0, z: 0 });
    s.select([id]);
  }, id);
  await pose();
  const beforeInspect = await hash();
  await page.evaluate(() => window.__forgelab.store.toggleCutaway(true));
  await shot("cutaway");
  assert.equal(await hash(), beforeInspect);
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.toggleCutaway(false);
    s.clearSelection();
  });
  await pose([3.8, 2.5, 4.5]);
  await page.waitForTimeout(800);
  const baseGeometries = await geometries();
  const memory = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      for (let i = 0; i < 12; i++)
        s.addPart("coolant-pump", { x: 4 + (i % 4) * 3, y: 1, z: Math.floor(i / 4) * 3 });
      s.clearSelection();
      s.requestFrame(null);
    });
    await page.waitForFunction((base) => {
      const { scene, gl } = window.__forgelab.three();
      let count = 0;
      scene.traverse((o) => {
        if (o.name === "pump-coupling") count++;
      });
      return count === 13 && gl.info.memory.geometries > base + 40;
    }, baseGeometries);
    const peak = await geometries();
    await page.evaluate((id) => {
      const s = window.__forgelab.store;
      s.select(
        s
          .getView()
          .snapshot.components.filter((c) => c.id !== id)
          .map((c) => c.id),
      );
      s.deleteSelected();
      s.clearSelection();
    }, id);
    await pose([3.8, 2.5, 4.5]);
    await page.waitForFunction((base) => {
      const { scene, gl } = window.__forgelab.three();
      let count = 0;
      scene.traverse((o) => {
        if (o.name === "pump-coupling") count++;
      });
      return count === 1 && gl.info.memory.geometries <= base + 12;
    }, baseGeometries);
    memory.push({ peak, after: await geometries() });
  }
  for (const m of memory)
    assert(m.after <= baseGeometries + 12, JSON.stringify({ baseGeometries, memory }));
  console.log(
    "✓ repeated placement/removal releases geometry",
    JSON.stringify({ baseGeometries, memory }),
  );

  const alone = await hash();
  await activate();
  await page.waitForTimeout(1000);
  assert(
    await page.evaluate(() =>
      [...window.__forgelab.director.getState().visuals.values()].every((v) => v.activity === 0),
    ),
  );
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), alone);
  console.log("✓ an unpowered standalone pump does not invent operating motion");

  await page.evaluate(() => window.__forgelab.loadBlueprint("reference-plant"));
  const plantHash = await hash();
  const pumpPosition = await page.evaluate(() => {
    const c = window.__forgelab.store
      .getView()
      .snapshot.components.find((c) => c.type === "coolant-pump");
    return c.transform.positionM;
  });
  await pose(
    [pumpPosition.x + 4.2, pumpPosition.y + 1.8, pumpPosition.z + 4.8],
    [pumpPosition.x, pumpPosition.y, pumpPosition.z],
  );
  await activate();
  await page.evaluate(() => window.__forgelab.store.setSpeed(2));
  await page.waitForFunction(
    () => [...window.__forgelab.director.getState().visuals.values()].some((v) => v.activity > 0.1),
    null,
    { timeout: 120000 },
  );
  const rotation = () =>
    page.evaluate(() => {
      const { scene } = window.__forgelab.three();
      const g = scene.getObjectByName("pump-coupling");
      return g?.rotation.y ?? null;
    });
  const r0 = await rotation();
  assert.notEqual(r0, null);
  await page.waitForFunction(
    (r) =>
      Math.abs(window.__forgelab.three().scene.getObjectByName("pump-coupling").rotation.y - r) >
      0.05,
    r0,
    { timeout: 120000 },
  );
  await shot("operating");
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), plantHash);
  assert.deepEqual(errors, []);
  console.log("✓ the existing reference plant drives the coupling; return to build is exact");
} finally {
  await browser.close();
}
