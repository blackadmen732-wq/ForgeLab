import { describe, expect, it } from "vitest";
import { filleted, pathLength, routePath, routeStyle, type V3 } from "./routing.js";

const end = (position: V3, normal: V3) => ({ position, normal });

describe("service routing", () => {
  it("runs a pipe out of each port, down to its rack, and orthogonally across", () => {
    const style = routeStyle("coolant");
    const path = routePath(end([0, 3, 0], [1, 0, 0]), end([10, 2, 8], [0, 0, -1]), style);
    expect(path[0]).toEqual([0, 3, 0]);
    expect(path[path.length - 1]).toEqual([10, 2, 8]);
    // Every leg is parallel to an axis: no diagonal runs through the hall.
    for (let i = 1; i < path.length; i += 1) {
      const d = path[i]!.map((v, k) => Math.abs(v - path[i - 1]![k]!));
      expect(d.filter((x) => x > 1e-9)).toHaveLength(1);
    }
    // The horizontal run is at the coolant rack height.
    expect(path.some((p) => Math.abs(p[1] - style.trayM) < 1e-9)).toBe(true);
  });

  it("draws rigid couplings straight", () => {
    const path = routePath(
      end([0, 1, 0], [1, 0, 0]),
      end([2, 1, 0], [-1, 0, 0]),
      routeStyle("shaft"),
    );
    expect(path).toEqual([
      [0, 1, 0],
      [2, 1, 0],
    ]);
  });

  it("sizes pipes from the port bore, within sensible limits", () => {
    const port = (d: number) =>
      ({
        domain: "fluid",
        label: "IN",
        direction: "in",
        fluid: "pressurized-water",
        innerDiameterM: d,
        ratedPressurePa: 1.5e7,
        ratedTemperatureK: 600,
      }) as const;
    expect(routeStyle("coolant", port(0.4)).radiusM).toBeCloseTo(0.23, 6);
    expect(routeStyle("coolant", port(5)).radiusM).toBe(0.6);
    expect(routeStyle("electrical").radiusM).toBeLessThan(routeStyle("coolant").radiusM);
  });

  it("rounds corners without changing where the route starts and ends", () => {
    const path = routePath(
      end([0, 3, 0], [1, 0, 0]),
      end([10, 2, 8], [0, 0, -1]),
      routeStyle("coolant"),
    );
    const round = filleted(path, 0.5);
    expect(round[0]).toEqual(path[0]);
    expect(round[round.length - 1]).toEqual(path[path.length - 1]);
    expect(pathLength(round)).toBeLessThan(pathLength(path));
  });
});
