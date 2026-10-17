/** Actual stock-machine construction in the production editor; local services are not needed. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";
const shots = process.env.E2E_SHOTS;
if (shots) await mkdir(shots, { recursive: true });
// Build test fixtures from the actual catalogue and core; do not fabricate browser physics.
const fixtureModule = await build({
  tsconfig: "tsconfig.base.json",
  stdin: {
    resolveDir: process.cwd(),
    contents: `
import { SimulationWorld, CONSTRUCTION_RECIPES, serializeWorld } from '@forgelab/sim-core';
import { buildReferencePlant, getComponentDefinition } from '@forgelab/reactor-components';
import { vec3, transform, Vec3Math, QuaternionMath } from '@forgelab/shared';
export const recipes = CONSTRUCTION_RECIPES.filter(r => r.role === 'generator' || r.role === 'turbine');
const world = new SimulationWorld(); buildReferencePlant(world);
for (const recipe of recipes) {
  const old = world.listComponents().find(c => c.type === recipe.resultType), links = [...old.connections];
  world.removeComponent(old.id);
  const ids = {};
  for (const p of recipe.parts) {
    ids[p.key] = old.id + '-' + p.key;
    world.addComponent(getComponentDefinition(p.type).createSpec({ id:ids[p.key], transform:transform(Vec3Math.add(old.transform.positionM, QuaternionMath.rotateVec3(old.transform.rotation, p.offset)), old.transform.rotation) }));
  }
  world.setBuildAssembly({id:old.id+'-construction',recipeId:recipe.id,partIds:ids});
  for (const j of recipe.joints) world.connect({componentId:ids[j.from[0]],connectionPointId:j.from[1]},{componentId:ids[j.to[0]],connectionPointId:j.to[1]});
  for (const link of links) {
    const map = e => e.componentId !== old.id ? e : {componentId:ids[recipe.externalPorts[e.connectionPointId][0]],connectionPointId:e.connectionPointId};
    world.connect(map(link.from),map(link.to),{id:link.id,type:link.type});
  }
}
export const operatingPlant = serializeWorld(world);
`,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { recipes, operatingPlant } = await import(
  `data:text/javascript;base64,${Buffer.from(fixtureModule.outputFiles[0].text).toString("base64")}`
);
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(90000);
const errors = [],
  evidence = { families: [], operation: null, errors };
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
const hash = () => page.evaluate(() => window.__forgelab.store.designHash());
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
      JSON.stringify({
        quality: "MEDIUM",
        bloom: false,
        haze: false,
        muted: true,
        cameraEffectsIntensity: 0,
      }),
    ),
  );
  await page.goto(`${base}/app?debug&new=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Blank project/ }).click();
  if (!(await page.evaluate(() => !!window.__forgelab)))
    await page.goto(`${base}/app?debug`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__forgelab?.three);
  await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
  await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
  await page.getByRole("region", { name: "Build machines from modules" }).waitFor();
  await shot("machine-library");
  console.log("✓ new machine workshop exposes meaningful construction paths");
  for (const recipe of recipes) {
    if (await page.evaluate(() => window.__forgelab.store.world.listComponents().length > 0))
      await page.evaluate(() => window.__forgelab.store.newBlank());
    await page.evaluate(() => window.__forgelab.store.toggleDrawer(true));
    await page
      .getByRole("button", {
        name: recipe.role === "generator" ? "Build generator" : "Build turbine",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => window.__forgelab.store.world.listBuildAssemblies().length === 1,
    );
    const assembly = await page.evaluate(
      () => window.__forgelab.store.world.listBuildAssemblies()[0],
    );
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0].state),
      "incomplete",
    );
    await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.toggleDrawer(false);
      s.toggleInspect(false);
    });
    await pose([18, 10, 19], [0, 1.5, 2]);
    await shot(`${recipe.resultType}-loose`);
    const before = await hash();
    await activate();
    await page.waitForFunction(() => window.__forgelab.store.frame?.timeSec > 0.5);
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.frame.plant.metrics.grossElectricW),
      0,
    );
    await page.evaluate(() => window.__forgelab.store.stopSimulation());
    assert.equal(await hash(), before);
    // Same public edit action used by the transform gizmo: each move must snap and
    // reconcile real joints, not merely render an assembled pose.
    await page.evaluate(
      ({ recipe, assembly }) => {
        const s = window.__forgelab.store;
        s.setPosition(assembly.partIds.base, { x: 0, y: 2 + recipe.parts[0].offset.y, z: 0 });
        for (const p of recipe.parts.slice(1)) {
          const c = s.world.requireComponent(assembly.partIds[p.key]);
          s.moveComponents([
            {
              id: c.id,
              position: { x: p.offset.x + 0.04, y: 2 + p.offset.y, z: p.offset.z },
              rotation: c.transform.rotation,
            },
          ]);
        }
        s.select(Object.values(assembly.partIds));
      },
      { recipe, assembly },
    );
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0].state),
      "complete",
    );
    await pose([12, 6, 11], [0, 1.8, 0]);
    await shot(`${recipe.resultType}-assembled`);
    // The inspector's actual focus and detach controls work on a single module.
    await page
      .locator("button.construction-module")
      .filter({ hasText: recipe.parts.find((p) => p.key === "rotor").name })
      .click();
    await page.getByRole("button", { name: "Detach module", exact: true }).click();
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0].state),
      "incomplete",
    );
    await pose([26, 11, 28], [6, 1.5, 0]);
    await shot(`${recipe.resultType}-rotor-detached`);
    await page.evaluate(() => window.__forgelab.store.undo());
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0].state),
      "complete",
    );
    const saved = await page.evaluate(() => {
      const s = window.__forgelab.store;
      s.select(Object.values(s.world.listBuildAssemblies()[0].partIds));
      return s.selectionAsAssembly("Reusable powertrain");
    });
    const savedHash = await hash();
    await page.waitForTimeout(1500); // the editor's existing draft-save debounce
    await page.goto(`${base}/app?debug&draft=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => window.__forgelab?.store?.world.listBuildAssemblies().length === 1,
    );
    await page.addStyleTag({ content: ".fx-debug{display:none!important}" });
    assert.equal(await hash(), savedHash);
    assert.equal(
      await page.evaluate(() => window.__forgelab.store.world.constructionStatus()[0].state),
      "complete",
    );
    await page.evaluate(
      (file) =>
        window.__forgelab.store.placeAssembly(file, "Reusable powertrain", { x: 18, y: 0, z: 0 }),
      saved,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.__forgelab.store.world.constructionStatus().filter((s) => s.state === "complete")
            .length,
      ),
      2,
    );
    evidence.families.push({
      id: recipe.id,
      looseInactive: true,
      snappedComplete: true,
      detachUndo: true,
      draftReload: true,
      independentReusableCopy: true,
    });
    console.log(
      `✓ ${recipe.resultType}: actual module placement, keyed snaps, detach/undo, draft reload and reusable copy`,
    );
  }
  await page.evaluate((file) => window.__forgelab.store.loadFile(file), operatingPlant);
  const design = await hash();
  await activate();
  await page.evaluate(() => window.__forgelab.store.setSpeed(10));
  await page.waitForFunction(
    () => window.__forgelab.store.frame?.plant.metrics.grossElectricW > 1e6,
    null,
    { timeout: 180000 },
  );
  evidence.operation = await page.evaluate(() => {
    const f = window.__forgelab,
      components = f.director.getState().reading.components;
    const rotors = components.filter(
      (c) => c.type === "generator-rotor" || c.type === "turbine-rotor",
    );
    return {
      grossElectricW: f.store.frame.plant.metrics.grossElectricW,
      rotors: rotors.map((c) => ({
        type: c.type,
        shaftPowerW: c.shaftPowerW,
        electricalOutputW: c.electricalOutputW,
        activity: f.director.getState().visuals.get(c.id)?.activity,
      })),
    };
  });
  assert(evidence.operation.rotors.every((r) => r.activity > 0));
  await page.evaluate(() => {
    const s = window.__forgelab.store;
    s.setSpeed(0);
    s.select(
      s
        .getView()
        .snapshot.components.filter(
          (c) => c.type.startsWith("generator-") || c.type.startsWith("turbine-"),
        )
        .map((c) => c.id),
    );
    s.toggleIsolate();
    s.toggleDrawer(false);
    s.toggleInspect(false);
  });
  const framing = await page.evaluate(() => {
    const parts = window.__forgelab.store
      .getView()
      .snapshot.components.filter(
        (c) => c.type.startsWith("generator-") || c.type.startsWith("turbine-"),
      );
    const minX = Math.min(...parts.map((c) => c.transform.positionM.x - c.geometry.sizeM.x / 2));
    const maxX = Math.max(...parts.map((c) => c.transform.positionM.x + c.geometry.sizeM.x / 2));
    const minZ = Math.min(...parts.map((c) => c.transform.positionM.z - c.geometry.sizeM.z / 2));
    const maxZ = Math.max(...parts.map((c) => c.transform.positionM.z + c.geometry.sizeM.z / 2));
    return {
      x: (minX + maxX) / 2,
      y: 2,
      z: (minZ + maxZ) / 2,
      span: Math.max(maxX - minX, maxZ - minZ, 10),
    };
  });
  await pose(
    [framing.x + framing.span * 0.8, framing.y + framing.span * 0.5, framing.z + framing.span],
    [framing.x + framing.span * 0.2, framing.y, framing.z],
  );
  await shot("operating-powertrain");
  await page.evaluate(() => window.__forgelab.store.stopSimulation());
  assert.equal(await hash(), design);
  assert.deepEqual(errors, []);
  if (shots) await writeFile(`${shots}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(
    "✓ both modular machines operate in the actual reference plant; output-driven rotors; exact Stop reset; no browser/GL errors",
  );
} catch (error) {
  await shot("failure").catch(() => {});
  throw error;
} finally {
  await browser.close();
}
