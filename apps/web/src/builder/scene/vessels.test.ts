import { describe, expect, it } from "vitest";
import { DoubleSide, FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { REACTOR_CHAMBER, TOKAMAK_VESSEL } from "@forgelab/reactor-components";
import { geometryLocalHalfExtentsM } from "@forgelab/sim-core";
import { machineModel } from "./machines.js";
import { internalModel } from "./internalModels.js";
import { portOpenings } from "./vesselGeometry.js";

describe.each([REACTOR_CHAMBER, TOKAMAK_VESSEL])("detailed $type", (definition) => {
  it("preserves engineering data and keeps batched detail inside the physical bounds", () => {
    const spec = definition.createSpec({ id: "vessel" });
    const original = JSON.stringify(spec);
    const h = geometryLocalHalfExtentsM(spec.geometry);
    const model = machineModel(spec.type, spec.geometry, spec.connectionPoints!)!;
    expect(model.replacesEnvelope).toBe(true);
    let triangles = 0;
    for (const geometry of [model.main, model.trim, model.accent]) {
      expect(geometry).not.toBeNull();
      const g = geometry!;
      triangles += (g.index?.count ?? g.getAttribute("position").count) / 3;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      for (const axis of ["x", "y", "z"] as const) {
        expect(b.min[axis]).toBeGreaterThanOrEqual(-h[axis] - 0.01);
        expect(b.max[axis]).toBeLessThanOrEqual(h[axis] + 0.01);
      }
      for (const name of ["position", "normal", "uv"]) {
        const a = g.getAttribute(name);
        expect(a.count).toBeGreaterThan(0);
        expect(Array.from(a.array).every(Number.isFinite)).toBe(true);
      }
      g.dispose();
    }
    console.log(`${spec.type}: ${triangles} triangles across three static buffers`);
    expect(triangles).toBeLessThan(55000);
    expect(JSON.stringify(spec)).toBe(original);
  });

  it("leaves the authoritative coolant and vacuum bores open through the casing", () => {
    const spec = definition.createSpec({ id: "vessel" });
    const model = machineModel(spec.type, spec.geometry, spec.connectionPoints!)!;
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const meshes = [model.main!, model.trim!, model.accent!].map((g) => new Mesh(g, material));
    for (const p of spec.connectionPoints!) {
      if (p.port?.domain !== "fluid" && p.port?.domain !== "vacuum") continue;
      const d = new Vector3(p.localDirection.x, p.localDirection.y, p.localDirection.z);
      const at = new Vector3(p.localPosition.x, p.localPosition.y, p.localPosition.z);
      const opening = portOpenings([p], 1)[0]!;
      const expected =
        p.port.domain === "fluid" ? p.port.innerDiameterM / 2 : p.port.flangeDiameterM / 2;
      expect(opening.boreM).toBe(expected);
      const u = new Vector3()
        .crossVectors(d, Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0))
        .normalize();
      const v = new Vector3().crossVectors(d, u);
      for (let i = 0; i < 9; i++) {
        const angle = (i * Math.PI) / 4,
          radius = i === 8 ? 0 : expected * 0.8;
        const origin = at
          .clone()
          .addScaledVector(d, 0.1)
          .addScaledVector(u, radius * Math.cos(angle))
          .addScaledVector(v, radius * Math.sin(angle));
        const ray = new Raycaster(origin, d.clone().negate(), 0, 0.35);
        expect(ray.intersectObjects(meshes), `${p.id}: aperture sample ${i}`).toHaveLength(0);
      }
    }
    for (const m of meshes) m.geometry.dispose();
    material.dispose();
  });

  it("has an inward-facing wall visible from inside the cavity", () => {
    const spec = definition.createSpec({ id: "vessel" });
    const g = spec.geometry;
    const model = machineModel(spec.type, g, spec.connectionPoints!)!;
    const material = new MeshBasicMaterial({ side: FrontSide });
    const origin = new Vector3(g.kind === "torus" ? g.majorRadiusM : 0, 0.2, 0);
    const ray = new Raycaster(origin, new Vector3(1, 0, 0));
    const hits = ray.intersectObject(new Mesh(model.main!, material));
    expect(hits.length).toBeGreaterThan(0);
    const radius = g.kind === "torus" ? g.minorRadiusM : g.kind === "cylinder" ? g.radiusM : 0;
    expect(hits[0]!.distance).toBeLessThan(radius);
    expect(hits[0]!.distance).toBeGreaterThan(radius * 0.8);
    material.dispose();
    for (const m of [model.main, model.trim, model.accent]) m?.dispose();
  });

  it("gives each existing product region a finite internal geometry without changing the spec", () => {
    const spec = definition.createSpec({ id: "vessel" });
    const original = JSON.stringify(spec);
    const model = internalModel(
      spec.type,
      spec.geometry,
      definition.product.internals,
      spec.connectionPoints!,
    );
    expect([...model.keys()]).toEqual(definition.product.internals.map((i) => i.id));
    const h = geometryLocalHalfExtentsM(spec.geometry);
    for (const g of model.values()) {
      g.computeBoundingBox();
      for (const axis of ["x", "y", "z"] as const) {
        expect(g.boundingBox!.min[axis]).toBeGreaterThanOrEqual(-h[axis] - 0.001);
        expect(g.boundingBox!.max[axis]).toBeLessThanOrEqual(h[axis] + 0.001);
      }
      expect(Array.from(g.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      g.dispose();
    }
    expect(JSON.stringify(spec)).toBe(original);
  });

  it("follows a resized engineering envelope and regenerated sockets", () => {
    const original = definition.createSpec({ id: "vessel" });
    const dimensions =
      definition.type === "tokamak-vessel"
        ? { majorRadiusM: 9, tubeRadiusM: 3, wallM: 0.12 }
        : { radiusM: 2, heightM: 5, wallM: 0.08 };
    const reshaped = definition.reshape(dimensions, original.materialId);
    const h = geometryLocalHalfExtentsM(reshaped.geometry);
    const model = machineModel(definition.type, reshaped.geometry, reshaped.connectionPoints)!;
    for (const g of [model.main, model.trim, model.accent]) {
      g!.computeBoundingBox();
      const b = g!.boundingBox!;
      expect(b.max.x).toBeGreaterThan(h.x * 0.8);
      expect(b.max.x).toBeLessThanOrEqual(h.x + 0.01);
      expect(b.min.y).toBeGreaterThanOrEqual(-h.y - 0.01);
      expect(b.max.y).toBeLessThanOrEqual(h.y + 0.01);
      g!.dispose();
    }
  });
});

it("exposes the tokamak armour tiles in front of the casing's inner skin", () => {
  const spec = TOKAMAK_VESSEL.createSpec({ id: "vessel" });
  const model = machineModel(spec.type, spec.geometry, spec.connectionPoints!)!;
  const regions = internalModel(
    spec.type,
    spec.geometry,
    TOKAMAK_VESSEL.product.internals,
    spec.connectionPoints!,
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const g = spec.geometry;
  if (g.kind !== "torus") throw new Error("Expected a toroidal vessel");
  const u = (7.5 * Math.PI * 2) / 48,
    v = Math.PI / 12;
  const ray = new Raycaster(
    new Vector3(g.majorRadiusM * Math.cos(u), 0, g.majorRadiusM * Math.sin(u)),
    new Vector3(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)),
  );
  const casing = ray.intersectObject(new Mesh(model.main!, material));
  const armour = ray.intersectObject(new Mesh(regions.get("first-wall")!, material));
  expect(armour.length).toBeGreaterThan(0);
  expect(casing.length).toBeGreaterThan(0);
  expect(armour[0]!.distance).toBeLessThan(casing[0]!.distance - 0.005);
  for (const geometry of [model.main, model.trim, model.accent, ...regions.values()])
    geometry?.dispose();
  material.dispose();
});
