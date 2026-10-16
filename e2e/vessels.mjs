/** Production-editor checks for the existing cylindrical and tokamak vessel types.
 * pnpm vercel-build && node scripts/serve-output.mjs 3000
 * E2E_SHOTS=/tmp/vessels node e2e/vessels.mjs http://localhost:3000
 * Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to use system Chromium.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000",
  shots = process.env.E2E_SHOTS;
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
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` });
};
const pose = async (p, t) => {
  await page.evaluate(({ p, t }) => window.__forgelab.store.requestPose(p, t), { p, t });
  await page.waitForFunction(
    (p) =>
      window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) < 0.01,
    p,
  );
};
const screen = (point) =>
  page.evaluate((p) => {
    const { camera, gl } = window.__forgelab.three(),
      r = gl.domElement.getBoundingClientRect();
    const v = camera.position
      .clone()
      .set(...p)
      .project(camera);
    return { x: r.x + ((v.x + 1) * r.width) / 2, y: r.y + ((1 - v.y) * r.height) / 2 };
  }, point);
const sockets = () =>
  page.evaluate(() => {
    const f = window.__forgelab;
    let mesh;
    f.three().scene.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.type === "SphereGeometry" && o.material.opacity === 0.95)
        mesh = o;
    });
    if (!mesh) return [];
    const matrix = f.three().camera.matrixWorld.clone();
    return Array.from({ length: mesh.count }, (_, i) => {
      mesh.getMatrixAt(i, matrix);
      return matrix.elements.slice(12, 15);
    });
  });
const waitSockets = (count) =>
  page.waitForFunction((count) => {
    let found = false;
    window.__forgelab.three().scene.traverse((o) => {
      if (
        o.isInstancedMesh &&
        o.geometry.type === "SphereGeometry" &&
        o.material.opacity === 0.95 &&
        o.count === count
      )
        found = true;
    });
    return found;
  }, count);

try {
  await page.addInitScript(() =>
    localStorage.setItem(
      "forgelab.presentation.v1",
      JSON.stringify({ quality: "MEDIUM", bloom: false, haze: false, muted: true }),
    ),
  );
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  assert.equal(
    await page.evaluate(() => window.__forgelab.store.getView().snapshot.components.length),
    0,
  );
  console.log("✓ the default hall remains empty");

  for (const [type, name, eye, target] of [
    ["tokamak-vessel", "Tokamak Vacuum Vessel", [19, 15, 22], [0, 2.3, 0]],
    ["reactor-chamber", "Cylindrical Vacuum Chamber", [5.3, 3.8, 6.3], [0, 1.5, 0]],
  ]) {
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.selectAll();
      s.deleteSelected();
      s.toggleDrawer(true);
      s.setTool("select");
    });
    await page.getByRole("textbox", { name: "Search parts", exact: true }).fill(name);
    await page.locator("button.part").filter({ hasText: name }).click();
    await page.waitForFunction(
      () => window.__forgelab.store.getView().snapshot.components.length === 1,
    );
    const id = await page.evaluate(
      () => window.__forgelab.store.getView().snapshot.components[0].id,
    );
    await page.evaluate(
      ({ id, y }) => {
        const s = window.__forgelab.store;
        s.setPosition(id, { x: 0, y, z: 0 });
        s.toggleDrawer(false);
        s.clearSelection();
      },
      { id, y: target[1] },
    );
    await pose(eye, target);
    await page.mouse.move(680, 70);
    await shot(`${type}-after`);
    const g = await page.evaluate(
      () => window.__forgelab.store.getView().snapshot.components[0].geometry,
    );
    const pick = await screen(
      type === "tokamak-vessel"
        ? [
            (g.majorRadiusM + g.minorRadiusM * Math.cos(0.45)) * Math.SQRT1_2,
            target[1] + g.minorRadiusM * Math.sin(0.45),
            (g.majorRadiusM + g.minorRadiusM * Math.cos(0.45)) * Math.SQRT1_2,
          ]
        : [g.radiusM * 0.6, target[1] + 0.2, g.radiusM * 0.8],
    );
    await page.mouse.click(pick.x, pick.y);
    await page.waitForFunction(
      (id) => window.__forgelab.store.getView().selection.includes(id),
      id,
    );

    await page.evaluate(() => window.__forgelab.store.setTool("connect"));
    const ports = await page.evaluate(() => {
      const c = window.__forgelab.store.getView().snapshot.components[0],
        p = c.transform.positionM;
      return c.connectionPoints.map((s) => ({
        id: s.id,
        position: [p.x + s.localPosition.x, p.y + s.localPosition.y, p.z + s.localPosition.z],
      }));
    });
    await waitSockets(ports.length);
    const actual = await sockets();
    for (let i = 0; i < ports.length; i++)
      for (let axis = 0; axis < 3; axis++)
        assert(
          Math.abs(actual[i][axis] - ports[i].position[axis]) < 1e-5,
          JSON.stringify({ actual: actual[i], expected: ports[i] }),
        );
    await shot(`${type}-ports`);
    const source = ports.find((p) => p.id === "vacuum"),
      cursor = await screen(source.position);
    await page.mouse.click(cursor.x, cursor.y);
    await page.waitForFunction(
      (id) => window.__forgelab.store.getView().connectFrom?.componentId === id,
      id,
    );
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.getView().connectFrom.connectionPointId),
      "vacuum",
    );
    await page.keyboard.press("Escape");
    console.log(
      `✓ ${type}: real-scale drawer placement, viewport picking and ${ports.length} correct clickable sockets`,
    );

    const original = await hash();
    await page.evaluate(
      ({ id, type }) => {
        const s = window.__forgelab.store;
        s.setDimension(
          id,
          type === "tokamak-vessel" ? "majorRadiusM" : "radiusM",
          type === "tokamak-vessel" ? 7.4 : 1.8,
        );
      },
      { id, type },
    );
    await page.waitForFunction((type) => {
      const f = window.__forgelab,
        c = f.store.getView().snapshot.components[0];
      let max = -Infinity;
      f.three().scene.traverse((o) => {
        if (o.userData.componentId === c.id)
          o.traverse((m) => {
            if (m.isMesh && m.geometry.type === "BufferGeometry") {
              m.geometry.computeBoundingBox();
              max = Math.max(max, m.geometry.boundingBox.max.x);
            }
          });
      });
      return max >= (type === "tokamak-vessel" ? 9.69 : 1.79);
    }, type);
    assert.notEqual(await hash(), original);
    await page.evaluate(() => window.__forgelab.store.undo());
    assert.equal(await hash(), original);
    await page.evaluate((id) => {
      const s = window.__forgelab.store;
      s.setPosition(id, {
        x: 4,
        y: s.getView().snapshot.components[0].transform.positionM.y,
        z: 0,
      });
      s.setRotationEuler(id, { x: 0, y: 90, z: 0 });
    }, id);
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.undo();
      s.undo();
    });
    assert.equal(await hash(), original);
    const file = await page.evaluate(() => window.__forgelab.store.exportFile());
    await page.evaluate((file) => window.__forgelab.store.loadFile(file), file);
    assert.equal(await hash(), original);
    const beforeCut = await page.evaluate(() => window.__forgelab.three().gl.info.render.frame);
    await page.evaluate((id) => {
      const s = window.__forgelab.store;
      s.select([id]);
      s.toggleCutaway(true);
    }, id);
    await pose(eye, target);
    await page.waitForFunction(
      ({ id, type, beforeCut }) => {
        const { scene, gl } = window.__forgelab.three();
        return (
          scene.getObjectByName(
            `internal:${id}:${type === "tokamak-vessel" ? "first-wall" : "limiter"}`,
          ) !== undefined && gl.info.render.frame > beforeCut
        );
      },
      { id, type, beforeCut },
    );
    assert.equal(
      await page.evaluate(
        ({ id, type }) =>
          window.__forgelab
            .three()
            .scene.getObjectByName(
              `internal:${id}:${type === "tokamak-vessel" ? "first-wall" : "limiter"}`,
            ).material.polygonOffset,
        { id, type },
      ),
      false,
    );
    await page.getByText("Schematic internal representation", { exact: true }).waitFor();
    await shot(`${type}-cutaway`);
    const sectionFrame = await page.evaluate(() => window.__forgelab.three().gl.info.render.frame);
    await page.evaluate(
      (y) => window.__forgelab.store.setSection({ axis: "y", offsetM: y, flip: false }),
      target[1],
    );
    await page.waitForFunction(
      (frame) => window.__forgelab.three().gl.info.render.frame > frame,
      sectionFrame,
    );
    await shot(`${type}-section`);
    assert.equal(await hash(), original);
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.setSection(null);
      s.toggleCutaway(false);
      s.clearSelection();
    });
    console.log(
      `✓ ${type}: dimension-driven mesh, undo, rotation, save/load and labelled interior`,
    );
  }

  // Browser reload proves that the new presentation does not become a save dependency.
  const draftHash = await hash();
  await page.waitForTimeout(1000);
  await page.goto(`${base}/app?debug&draft=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.waitForFunction(
    () => window.__forgelab.store.getView().snapshot.components.length === 1,
  );
  assert.equal(await hash(), draftHash);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  // Upload the hall's wide-view geometry before counting machine allocations.
  await pose([100, 65, 120], [0, 0, 0]);
  await page.screenshot();
  await pose([5.3, 3.8, 6.3], [0, 1.5, 0]);
  const geometries = () => page.evaluate(() => window.__forgelab.three().gl.info.memory.geometries);
  const baseline = await geometries(),
    memory = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const keep = await page.evaluate(
      () => window.__forgelab.store.getView().snapshot.components[0].id,
    );
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      for (let i = 0; i < 6; i++)
        s.addPart(i % 2 ? "reactor-chamber" : "tokamak-vessel", {
          x: 22 + (i % 3) * 22,
          y: 0,
          z: Math.floor(i / 3) * 22,
        });
      s.clearSelection();
      s.requestFrame(null);
    });
    await page.waitForFunction(
      (base) => window.__forgelab.three().gl.info.memory.geometries >= base + 18,
      baseline,
    );
    const peak = await geometries();
    await page.evaluate((keep) => {
      const f = window.__forgelab,
        ids = new Set(
          f.store
            .getView()
            .snapshot.components.filter((c) => c.id !== keep)
            .map((c) => c.id),
        );
      const geometries = new Set();
      f.three().scene.traverse((o) => {
        if (ids.has(o.userData.componentId))
          o.traverse((m) => {
            if (m.isMesh) geometries.add(m.geometry);
          });
      });
      const trace = { expected: geometries.size, disposed: new Set() };
      window.__vesselGeometryCheck = trace;
      for (const g of geometries) g.addEventListener("dispose", () => trace.disposed.add(g.uuid));
    }, keep);
    await page.evaluate((keep) => {
      const s = window.__forgelab.store;
      s.select(
        s
          .getView()
          .snapshot.components.filter((c) => c.id !== keep)
          .map((c) => c.id),
      );
      s.deleteSelected();
      s.clearSelection();
    }, keep);
    await pose([5.3, 3.8, 6.3], [0, 1.5, 0]);
    await page.waitForFunction(() => {
      const trace = window.__vesselGeometryCheck;
      return trace.expected > 0 && trace.expected === trace.disposed.size;
    });
    await page.waitForFunction(
      (base) => window.__forgelab.three().gl.info.memory.geometries <= base + 8,
      baseline,
    );
    const released = await page.evaluate(() => window.__vesselGeometryCheck.disposed.size);
    memory.push({ peak, after: await geometries(), released });
    console.log(
      `✓ mixed-vessel resource cycle ${cycle + 1}`,
      JSON.stringify({ baseline, ...memory[memory.length - 1] }),
    );
  }
  console.log(
    "✓ browser draft reload and repeated mixed-vessel placement/removal",
    JSON.stringify({ baseline, memory }),
  );

  await page.evaluate(() => window.__forgelab.loadBlueprint("iter-class-plant"));
  const assembled = await hash();
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    const c = s.getView().snapshot.components.find((c) => c.type === "tokamak-vessel");
    s.select([c.id]);
    s.setPeel(2);
    s.setSection({ axis: "z", offsetM: c.transform.positionM.z, flip: false });
  });
  await pose([45, 24, 48], [0, 6, 0]);
  await shot("assembled-cutaway");
  await page.evaluate(() => {
    const s = window.__forgelab.store,
      c = s.getView().snapshot.components.find((c) => c.type === "tokamak-vessel");
    s.setPeel(4);
    s.setSection({ axis: "y", offsetM: c.transform.positionM.y, flip: false });
  });
  await pose([30, 25, 34], [0, 8.35, 0]);
  await shot("assembled-vessel-inspection");
  assert.equal(await hash(), assembled);
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.setSection(null);
    s.setPeel(0);
    s.clearSelection();
    window.__forgelab.loadBlueprint("reference-plant");
  });
  const plant = await hash();
  await page.locator("button.simulate-btn").click();
  await page.waitForFunction(
    () =>
      window.__forgelab.store.getView().mode === "simulate" ||
      document.querySelector('[role="dialog"]'),
  );
  const preflight = page.locator('[role="dialog"]:has-text("Preflight")');
  if (await preflight.isVisible())
    await preflight.getByRole("button", { name: "Activate anyway", exact: true }).click();
  await page.evaluate(() => window.__forgelab.store.setSpeed(5));
  await page.waitForFunction(
    () =>
      Object.values(window.__forgelab.director.getState().reading?.vessels ?? {}).some((v) =>
        ["ramp-up", "flat-top"].includes(v.plasma.phase),
      ),
    null,
    { timeout: 120000 },
  );
  const center = await page.evaluate(() => {
    const s = window.__forgelab.store,
      c = s.getView().snapshot.components.find((c) => c.type === "tokamak-vessel");
    s.select([c.id]);
    s.toggleCutaway(true);
    s.setSection({ axis: "y", offsetM: c.transform.positionM.y + 0.5, flip: false });
    return c.transform.positionM;
  });
  await pose([center.x + 24, center.y + 18, center.z + 26], [center.x, center.y, center.z]);
  await shot("reference-plant-operating");
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), plant);
  assert.deepEqual(errors, []);
  console.log(
    "✓ assembled plant inspection, physics-driven ignition and exact return to build; no browser errors",
  );
} catch (error) {
  console.error(
    "Browser state at failure",
    await page
      .evaluate(() => {
        const f = window.__forgelab,
          trace = window.__vesselGeometryCheck;
        return f
          ? {
              mode: f.store.getView().mode,
              components: f.store.getView().snapshot.components.length,
              geometries: f.three?.().gl.info.memory.geometries,
              trace: trace ? { expected: trace.expected, disposed: trace.disposed.size } : null,
            }
          : null;
      })
      .catch(() => null),
  );
  if (shots) await page.screenshot({ path: `${shots}/failure.png` }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
