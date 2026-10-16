/** Modular pump vertical slice in the production editor, without cloud services. */
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
const shot = async (name) => {
  if (shots) await page.screenshot({ path: `${shots}/pump-kit-${name}.png` });
};
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
const state = () =>
  page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0]?.state);
const pose = async (p, t) => {
  await page.evaluate(({ p, t }) => window.__forgelab.store.requestPose(p, t), { p, t });
  await page.waitForFunction(
    (p) =>
      window.__forgelab.three().camera.position.distanceTo({ x: p[0], y: p[1], z: p[2] }) < 0.01,
    p,
  );
};
const activate = async () => {
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
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug{display:none!important;}" });
  await page.addStyleTag({ content: ".fx-debug{display:none!important;}" });
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("button", { name: "Kits", exact: true }).click();
  await page
    .locator("button.part")
    .filter({ has: page.locator(".part__name", { hasText: /^Coolant Pump Kit$/ }) })
    .click();
  await page.waitForFunction(
    () => window.__forgelab.store.world.listBuildAssemblies().length === 1,
  );
  const assembly = await page.evaluate(
    () => window.__forgelab.store.world.listBuildAssemblies()[0],
  );
  assert.equal(await state(), "incomplete");
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.toggleDrawer(false);
    s.toggleInspect(false);
  });
  await pose([9, 6, 11], [0, 0.8, 0]);
  await shot("loose-modules");
  const before = await hash();
  await activate();
  await page.waitForFunction(() => window.__forgelab.store.frame?.timeSec > 0.5);
  assert(await page.evaluate(() => window.__forgelab.store.frame.plant.metrics.houseLoadW === 0));
  assert(
    await page.evaluate(() =>
      [...window.__forgelab.director.getState().visuals.values()].every((v) => v.activity === 0),
    ),
  );
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), before);
  console.log("✓ four loose modules; incomplete construction stays inactive and reset is exact");

  // Place a NEW casing through the real drawer/ghost/canvas path, replacing its loose predecessor.
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("button", { name: "Parts", exact: true }).click();
  await page.getByRole("textbox", { name: "Search parts", exact: true }).fill("Pump Casing");
  await page
    .locator("button.part")
    .filter({ has: page.locator(".part__name", { hasText: /^Pump Casing$/ }) })
    .click();
  await page.waitForFunction(() => window.__forgelab.store.getView().placement !== null);
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(false));
  await pose([-0.3, 3.7, 5], [-4.2, 0.8, 0]);
  const mount = await page.evaluate((a) => {
    const s = window.__forgelab.store,
      c = s.world.requireComponent(a.partIds.base),
      p = c.transform.positionM;
    return { x: p.x, y: p.y + 0.125, z: p.z };
  }, assembly);
  const screen = await page.evaluate(
    (p) => window.__forgelab.store.viewport.project([p])[0],
    mount,
  );
  await page.mouse.move(screen.x, screen.y);
  await page.waitForFunction(() => window.__forgelab.store.getView().placement?.mate !== null);
  assert.equal(await hash(), before);
  await shot("snap-preview");
  await page.keyboard.down("Alt");
  await page.mouse.move(screen.x + 2, screen.y);
  await page.waitForFunction(() => window.__forgelab.store.getView().placement?.mate === null);
  await page.keyboard.up("Alt");
  await page.mouse.move(screen.x, screen.y);
  await page.waitForFunction(() => window.__forgelab.store.getView().placement?.mate !== null);
  await page.mouse.click(screen.x, screen.y);
  await page.waitForFunction(() => window.__forgelab.store.getView().placement === null);
  const casingId = await page.evaluate(
    () => window.__forgelab.store.world.listBuildAssemblies()[0].partIds.casing,
  );
  assert.notEqual(casingId, assembly.partIds.casing);
  await page.evaluate((id) => {
    const s = window.__forgelab.store;
    s.select([id]);
    s.deleteSelected();
  }, assembly.partIds.casing);
  console.log("✓ real translucent ghost, stable keyed snap, Alt bypass and canvas placement");
  // Drive and motor are existing loose modules, moved through the same store action as the gizmo.
  for (const [key, dy] of [
    ["drive", 0.775],
    ["motor", 1.375],
  ]) {
    await page.evaluate(
      ({ a, key, dy }) => {
        const s = window.__forgelab.store,
          b = s.world.requireComponent(a.partIds.base),
          c = s.world.requireComponent(a.partIds[key]);
        s.moveComponents([
          {
            id: c.id,
            position: {
              x: b.transform.positionM.x + 0.1,
              y: b.transform.positionM.y + dy,
              z: b.transform.positionM.z,
            },
            rotation: b.transform.rotation,
          },
        ]);
      },
      { a: assembly, key, dy },
    );
  }
  assert.equal(await state(), "complete");
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
  });
  await pose([-0.8, 3.1, 4.4], [-4.2, 1, 0]);
  await shot("assembled");
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.clearSelection();
    s.setTool("select");
  });
  await shot("hero");
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
  });
  await page.evaluate(() => window.__forgelab.store.undo());
  assert.equal(await state(), "incomplete");
  await page.evaluate(() => window.__forgelab.store.redo());
  assert.equal(await state(), "complete");
  await page.evaluate(() => window.__forgelab.store.groupSelected("Workshop pump"));
  await page.evaluate(() => window.__forgelab.store.rotateSelection90());
  assert.equal(await state(), "complete");
  // Clear the selection gizmo before picking a visible motor inside the existing group.
  await page.evaluate(() => window.__forgelab.store.clearSelection());
  await page.waitForTimeout(350);
  const picks = await page.evaluate((a) => {
    const s = window.__forgelab.store,
      c = s.world.requireComponent(a.partIds.motor),
      p = c.transform.positionM;
    return s.viewport.project([
      { x: p.x + 0.2, y: p.y + 0.35, z: p.z + 0.2 },
      { x: p.x - 0.2, y: p.y + 0.35, z: p.z + 0.2 },
      { x: p.x + 0.2, y: p.y + 0.35, z: p.z - 0.2 },
    ]);
  }, assembly);
  await page.keyboard.down("Alt");
  for (const pick of picks) {
    if (!pick) continue;
    await page.mouse.click(pick.x, pick.y);
    if (
      await page.evaluate((id) => {
        const selection = window.__forgelab.store.getView().selection;
        return selection.length === 1 && selection[0] === id;
      }, assembly.partIds.motor)
    )
      break;
  }
  await page.keyboard.up("Alt");
  const pickedActual = await page.evaluate((id) => {
    const a = window.__forgelab.store.getView().selection;
    return a.length === 1 && a[0] === id;
  }, assembly.partIds.motor);
  assert(pickedActual, "Actual Alt-picking after undo/redo and rotation");
  await page.getByRole("button", { name: "Detach module", exact: true }).click();
  assert.equal(await state(), "incomplete");
  await shot("detached");
  await page.evaluate(() => window.__forgelab.store.undo());
  assert.equal(await state(), "complete");
  console.log("✓ completion, undo/redo, group rotation, actual Alt-picking, detach and reassemble");

  const ports = await page.evaluate(
    () => window.__forgelab.store.world.constructionStatus()[0].externalPorts,
  );
  assert.equal(ports.power.componentId, assembly.partIds.motor);
  assert.equal(ports.inlet.componentId, casingId);
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
    s.setTool("connect");
  });
  const overlays = await page.evaluate(() => {
    const f = window.__forgelab,
      expected = f.store.getView().snapshot.components.flatMap((c) =>
        c.connectionPoints.map((p) => {
          const q = c.transform.rotation,
            v = p.localPosition;
          const tx = 2 * (q.y * v.z - q.z * v.y),
            ty = 2 * (q.z * v.x - q.x * v.z),
            tz = 2 * (q.x * v.y - q.y * v.x);
          return [
            c.transform.positionM.x + v.x + q.w * tx + (q.y * tz - q.z * ty),
            c.transform.positionM.y + v.y + q.w * ty + (q.z * tx - q.x * tz),
            c.transform.positionM.z + v.z + q.w * tz + (q.x * ty - q.y * tx),
          ];
        }),
      );
    let mesh;
    f.three().scene.traverse((o) => {
      if (o.isInstancedMesh && o.geometry.type === "SphereGeometry" && o.material.opacity === 0.95)
        mesh = o;
    });
    const matrix = f.three().camera.matrixWorld.clone();
    return {
      expected,
      actual: mesh
        ? Array.from({ length: mesh.count }, (_, i) => {
            mesh.getMatrixAt(i, matrix);
            return matrix.elements.slice(12, 15);
          })
        : [],
    };
  });
  assert.equal(overlays.actual.length, overlays.expected.length);
  for (const p of overlays.expected)
    assert(
      overlays.actual.some((a) => a.every((n, i) => Math.abs(n - p[i]) < 1e-4)),
      JSON.stringify({ missing: p }),
    );
  await shot("ports");
  const saved = await page.evaluate(() => window.__forgelab.store.exportFile()),
    savedHash = await hash();
  await page.evaluate((f) => window.__forgelab.store.loadFile(f), saved);
  assert.equal(await hash(), savedHash);
  await page.waitForTimeout(1500);
  await page.goto(`${base}/app?debug&draft=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug{display:none!important;}" });
  assert.equal(await hash(), savedHash);
  assert.equal(await state(), "complete");
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
    s.toggleDrawer(true);
  });
  await page.getByRole("button", { name: "My Assemblies", exact: true }).click();
  await page.getByRole("button", { name: "Save selection as assembly", exact: true }).click();
  await page.getByRole("textbox", { name: "Assembly name", exact: true }).fill("Workshop Pump");
  await page
    .locator(".drawer__save-form")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await page.locator("button.part__place").filter({ hasText: "Workshop Pump" }).click();
  await page.waitForFunction(
    () =>
      window.__forgelab.store.world.constructionStatus().filter((s) => s.state === "complete")
        .length === 2,
  );
  assert.equal(
    await page.evaluate(
      () =>
        new Set(
          window.__forgelab.store.world
            .listBuildAssemblies()
            .flatMap((a) => Object.values(a.partIds)),
        ).size,
    ),
    8,
  );
  console.log(
    "✓ authored port ownership, project/draft reload and an independent saved-assembly copy",
  );

  // Warm the hall at the same view used for the resource test, then repeat placement/removal.
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.toggleDrawer(false);
    s.clearSelection();
    s.setTool("select");
  });
  await pose([20, 14, 22], [2, 0, 0]);
  await page.waitForTimeout(300);
  const baseGeometries = await page.evaluate(
      () => window.__forgelab.three().gl.info.memory.geometries,
    ),
    memory = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    const extraIds = await page.evaluate(() => {
      const s = window.__forgelab.store,
        before = new Set(s.world.listComponents().map((c) => c.id));
      s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
      const file = s.selectionAsAssembly("Resource test pump");
      for (let i = 0; i < 4; i++)
        s.placeAssembly(file, "Resource test pump", { x: 6 + i * 3, y: 0, z: 4 });
      s.clearSelection();
      return s.world
        .listComponents()
        .map((c) => c.id)
        .filter((id) => !before.has(id));
    });
    await page.waitForFunction((ids) => {
      let count = 0;
      window.__forgelab.three().scene.traverse((o) => {
        if (ids.includes(o.userData.componentId)) count++;
      });
      return count === ids.length;
    }, extraIds);
    await page.waitForFunction(
      (base) => window.__forgelab.three().gl.info.memory.geometries > base + 20,
      baseGeometries,
    );
    const resources = await page.evaluate((ids) => {
      const gs = new Set();
      window.__pumpKitDisposals = 0;
      window.__forgelab.three().scene.traverse((o) => {
        if (ids.includes(o.userData.componentId))
          o.traverse((c) => {
            if (c.geometry) gs.add(c.geometry);
          });
      });
      for (const g of gs) g.addEventListener("dispose", () => window.__pumpKitDisposals++);
      return { count: gs.size, peak: window.__forgelab.three().gl.info.memory.geometries };
    }, extraIds);
    await page.evaluate((ids) => {
      const s = window.__forgelab.store;
      s.select(ids);
      s.deleteSelected();
      s.clearSelection();
    }, extraIds);
    await page.waitForFunction((count) => window.__pumpKitDisposals >= count, resources.count);
    await page.waitForFunction(
      (base) => window.__forgelab.three().gl.info.memory.geometries <= base + 10,
      baseGeometries,
    );
    memory.push({
      ...resources,
      disposed: await page.evaluate(() => window.__pumpKitDisposals),
      after: await page.evaluate(() => window.__forgelab.three().gl.info.memory.geometries),
    });
  }
  console.log(
    "✓ repeated modular placement/removal releases geometry",
    JSON.stringify({ baseGeometries, memory }),
  );

  // Old finished pumps and their operating reference plant remain supported.
  await page.evaluate(() => window.__forgelab.loadBlueprint("reference-plant"));
  const plantHash = await hash();
  await activate();
  await page.waitForFunction(() => window.__forgelab.store.frame?.timeSec > 2);
  assert(
    await page.evaluate(() =>
      window.__forgelab.store.frame.plant.loops.some((l) => l.massFlowKgS > 0),
    ),
  );
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), plantHash);
  const modularPlant = await page.evaluate(
    ({ modules, slots }) => {
      const file = window.__forgelab.store.exportFile(),
        old = file.components.find((c) => c.type === "coolant-pump");
      const offsets = {
        base: [0, -0.875, 0],
        casing: [0, -0.15, 0],
        drive: [0, -0.1, 0],
        motor: [0, 0.5, 0],
      };
      const partIds = Object.fromEntries(
        Object.keys(offsets).map((key) => [key, key === "casing" ? old.id : `${old.id}-${key}`]),
      );
      const rotate = (v) => {
        const q = old.transform.rotation,
          tx = 2 * (q.y * v[2] - q.z * v[1]),
          ty = 2 * (q.z * v[0] - q.x * v[2]),
          tz = 2 * (q.x * v[1] - q.y * v[0]);
        return [
          v[0] + q.w * tx + q.y * tz - q.z * ty,
          v[1] + q.w * ty + q.z * tx - q.x * tz,
          v[2] + q.w * tz + q.x * ty - q.y * tx,
        ];
      };
      const parts = Object.entries(offsets).map(([key, offset]) => {
        const source = modules.find((c) => c.id === slots[key]),
          v = rotate(offset),
          p = old.transform.positionM;
        const spec = { ...source };
        delete spec.physical;
        return {
          ...spec,
          id: partIds[key],
          transform: {
            positionM: { x: p.x + v[0], y: p.y + v[1], z: p.z + v[2] },
            rotation: old.transform.rotation,
          },
        };
      });
      const owner = {
        base: "base",
        inlet: "casing",
        outlet: "casing",
        power: "motor",
        control: "motor",
      };
      const endpoint = (e) =>
        e.componentId === old.id ? { ...e, componentId: partIds[owner[e.connectionPointId]] } : e;
      const connections = file.connections.map((c) => ({
        ...c,
        from: endpoint(c.from),
        to: endpoint(c.to),
      }));
      for (const [i, a, b] of [
        [0, ["base", "casing-seat"], ["casing", "base"]],
        [1, ["casing", "drive-seat"], ["drive", "casing-mate"]],
        [2, ["drive", "motor-seat"], ["motor", "base"]],
      ])
        connections.push({
          id: `modular-pump-joint-${i}`,
          type: "mount",
          from: { componentId: partIds[a[0]], connectionPointId: a[1] },
          to: { componentId: partIds[b[0]], connectionPointId: b[1] },
        });
      return {
        file: {
          ...file,
          components: [...file.components.filter((c) => c.id !== old.id), ...parts],
          connections,
          buildAssemblies: [{ id: "plant-pump-kit", recipeId: "coolant-pump-kit-v1", partIds }],
        },
        partIds,
        position: old.transform.positionM,
      };
    },
    { modules: saved.components, slots: saved.buildAssemblies[0].partIds },
  );
  await page.evaluate((file) => window.__forgelab.store.loadFile(file), modularPlant.file);
  assert.equal(await state(), "complete");
  const modularHash = await hash(),
    p = modularPlant.position;
  await page.evaluate((ids) => {
    const s = window.__forgelab.store;
    s.select(Object.values(ids));
    s.toggleDrawer(false);
    s.toggleInspect(false);
  }, modularPlant.partIds);
  await pose([p.x + 4.2, p.y + 1.8, p.z + 4.8], [p.x, p.y, p.z]);
  await activate();
  await page.waitForFunction(
    (id) =>
      window.__forgelab.store.frame?.plant.loops.some(
        (l) => l.componentIds.includes(id) && l.massFlowKgS > 100,
      ),
    modularPlant.partIds.casing,
  );
  const rotation = await page.evaluate(
    () => window.__forgelab.three().scene.getObjectByName("pump-kit-coupling")?.rotation.y,
  );
  assert.notEqual(rotation, undefined);
  await page.waitForFunction(
    (r) =>
      Math.abs(
        window.__forgelab.three().scene.getObjectByName("pump-kit-coupling").rotation.y - r,
      ) > 0.05,
    rotation,
  );
  await shot("operating");
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), modularHash);
  console.log(
    "✓ modular pump drives real coolant flow and coupling animation; exact build restored",
  );
  assert.deepEqual(errors, []);
  console.log("✓ legacy plant operates, exact return to build, no browser errors");
} catch (error) {
  await shot("failure");
  throw error;
} finally {
  await browser.close();
}
