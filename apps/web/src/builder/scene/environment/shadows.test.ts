import { describe, expect, it } from "vitest";
import { Box3, DirectionalLight, PerspectiveCamera, Vector3 } from "three";
import { fitPlantShadow, includeVisibleFloor } from "./shadows.js";

function expectCovered(light: DirectionalLight, bounds: Box3) {
  const direction = light.position.clone().normalize();
  for (let i = 0; i < 8; i += 1) {
    const p = new Vector3(
      i & 1 ? bounds.max.x : bounds.min.x,
      i & 2 ? bounds.max.y : bounds.min.y,
      i & 4 ? bounds.max.z : bounds.min.z,
    );
    const floor = p.clone().addScaledVector(direction, -p.y / direction.y);
    for (const point of [p, floor]) {
      const ndc = point.project(light.shadow.camera);
      expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
    }
  }
}

describe("plant shadow projection", () => {
  it("keeps wide-view floor shadows covered and tightens when looking down at a machine", () => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(0, 20, 0);
    camera.lookAt(0, 0, 0);
    const close = new Box3();
    includeVisibleFloor(close, camera, 70, 45);
    expect(close.max.x - close.min.x).toBeLessThan(20);
    expect(close.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    camera.position.set(0, 300, 0);
    camera.lookAt(0, 0, 0);
    const wide = new Box3();
    includeVisibleFloor(wide, camera, 70, 45);
    expect(wide.min.x).toBeCloseTo(-70);
    expect(wide.max.z).toBeCloseTo(45);
    const light = new DirectionalLight();
    fitPlantShadow(light, wide, 2048);
    expectCovered(light, wide);
  });
  it("gives a small machine more detail than the former 160 m hall projection", () => {
    const light = new DirectionalLight();
    const bounds = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 4, 2));
    fitPlantShadow(light, bounds, 2048);
    const camera = light.shadow.camera;
    expect(camera.right - camera.left).toBe(32);
    expect(light.shadow.normalBias).toBeLessThan(0.01);
    expectCovered(light, bounds);
  });

  it.each([
    [new Vector3(-40, 0, -30), new Vector3(40, 50, 30)],
    [new Vector3(450, 10, -620), new Vector3(510, 90, -560)],
    [new Vector3(-810, -5, 900), new Vector3(-750, 40, 950)],
  ])("retains the full assembly and its projected floor shadow", (min, max) => {
    const light = new DirectionalLight();
    const bounds = new Box3(min, max);
    fitPlantShadow(light, bounds, 1024);
    expectCovered(light, bounds);
  });

  it("anchors shadow edges to texels and changes no design geometry", () => {
    const light = new DirectionalLight();
    const bounds = new Box3(new Vector3(1, 0, 3), new Vector3(5, 8, 7));
    const before = bounds.clone();
    fitPlantShadow(light, bounds, 2048);
    expect(bounds.equals(before)).toBe(true);
    const c = light.shadow.camera;
    const texel = (c.right - c.left) / 2048;
    const mid = (c.left + c.right) / 2;
    expect(mid / texel).toBeCloseTo(Math.round(mid / texel), 8);
    bounds.translate(new Vector3(0.00001, 0, 0));
    fitPlantShadow(light, bounds, 2048);
    expect((c.left + c.right) / 2).toBeCloseTo(mid, 8);
    bounds.translate(new Vector3(-0.00001, 0, 0));
    expect(bounds.min.distanceTo(before.min)).toBeLessThan(1e-10);
    expect(bounds.max.distanceTo(before.max)).toBeLessThan(1e-10);
  });
});
