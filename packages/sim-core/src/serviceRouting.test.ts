import { describe, expect, it } from "vitest";
import { transform, vec3, QuaternionMath } from "@forgelab/shared";
import { boxGeometry, cylinderGeometry, torusGeometry, worldAabb } from "./geometry.js";
import { filleted, routeStyle, type V3 } from "./serviceGeometry.js";
import {
  distanceToRouteObstacle,
  planServiceRoute,
  routeBlockers,
  segmentDistance,
  type RouteObstacle,
} from "./serviceRouting.js";
const end = (position: V3, normal: V3) => ({ position, normal });
function box(id: string, position: V3, size: V3): RouteObstacle {
  const geometry = boxGeometry(vec3(...size)),
    t = transform(vec3(...position));
  return { id, label: id, geometry, transform: t, bounds: worldAabb(geometry, t) };
}
const empty = { obstacles: [], services: [], groundM: 0 };

describe("service occupied volume", () => {
  it("distinguishes crossing in plan from intersection in 3D, including parallel/zero-length segments", () => {
    expect(segmentDistance([-2, 0, 0], [2, 0, 0], [0, 0, -2], [0, 0, 2])).toBeCloseTo(0);
    expect(segmentDistance([-2, 0.5, 0], [2, 0.5, 0], [0, 0, -2], [0, 0, 2])).toBeCloseTo(0.5);
    expect(segmentDistance([0, 0, 0], [2, 0, 0], [0, 1, 0], [2, 1, 0])).toBeCloseTo(1);
    expect(segmentDistance([1, 0, 0], [1, 0, 0], [0, 1, 0], [2, 1, 0])).toBeCloseTo(1);
  });
  it("rejects a pipe through a floor cable, while permitting a real elevated crossing", () => {
    const scene = {
      ...empty,
      services: [
        {
          id: "floor-cable",
          radiusM: 0.07,
          points: [
            [-2, 0.07, 0],
            [2, 0.07, 0],
          ] as V3[],
        },
      ],
    };
    expect(
      routeBlockers(
        [
          [0, 0.18, -2],
          [0, 0.18, 2],
        ],
        0.18,
        scene,
      ),
    ).toEqual([{ kind: "service", id: "floor-cable", label: "Service floor-cable" }]);
    expect(
      routeBlockers(
        [
          [0, 0.5, -2],
          [0, 0.5, 2],
        ],
        0.18,
        scene,
      ),
    ).toEqual([]);
  });
  it("checks the floor using the complete tube radius and the actual ground elevation", () => {
    expect(
      routeBlockers(
        [
          [0, 10.04, 0],
          [4, 10.04, 0],
        ],
        0.07,
        { ...empty, groundM: 10 },
      )[0]?.kind,
    ).toBe("floor");
    expect(
      routeBlockers(
        [
          [0, 10.07, 0],
          [4, 10.07, 0],
        ],
        0.07,
        { ...empty, groundM: 10 },
      ),
    ).toEqual([]);
  });
  it("finds a route around solid machinery rather than drawing through it", () => {
    const scene = { ...empty, obstacles: [box("beam", [5, 1, 0], [2, 2, 2])] };
    const route = planServiceRoute(
      "cable",
      end([0, 0.6, 0], [1, 0, 0]),
      end([10, 0.6, 0], [-1, 0, 0]),
      routeStyle("electrical"),
      scene,
    );
    expect(route.state).toBe("clear");
    expect(route.points[0]).toEqual([0, 0.6, 0]);
    expect(route.points.at(-1)).toEqual([10, 0.6, 0]);
    expect(route.points.some((p) => p[1] > 2.1 || Math.abs(p[2]) > 1.1)).toBe(true);
    expect(route.lengthM).toBeGreaterThan(10);
    expect(routeBlockers(route.points, route.radiusM, scene)).toEqual([]);
  });
  it("finds a nonintersecting route over an existing cable with sufficient tube clearance", () => {
    const scene = {
      ...empty,
      services: [
        {
          id: "wire",
          radiusM: 0.07,
          points: [
            [5, 0.07, -3],
            [5, 0.07, 3],
          ] as V3[],
        },
      ],
    };
    const style = { ...routeStyle("coolant"), trayM: 0.18 };
    const route = planServiceRoute(
      "pipe",
      end([0, 0.8, 0], [1, 0, 0]),
      end([10, 0.8, 0], [-1, 0, 0]),
      style,
      scene,
    );
    expect(route.state).toBe("clear");
    expect(routeBlockers(route.points, route.radiusM, scene)).toEqual([]);
  });
  it("reports an actual blocker when a terminal is enclosed by an unrelated solid", () => {
    const scene = { ...empty, obstacles: [box("blocking wall", [0, 1, 0], [2, 2, 2])] };
    const route = planServiceRoute(
      "cable",
      end([0, 1, 0], [1, 0, 0]),
      end([10, 1, 0], [-1, 0, 0]),
      routeStyle("electrical"),
      scene,
    );
    expect(route.state).toBe("blocked");
    expect(route.blockers).toContainEqual({
      kind: "component",
      id: "blocking wall",
      label: "blocking wall",
    });
  });
  it("never treats the entire endpoint machine as empty when allowing its port penetration", () => {
    const scene = { ...empty, sourceId: "pump", obstacles: [box("pump", [0, 1, 0], [2, 2, 2])] };
    const intoMachine: V3[] = [
      [1, 1, 0],
      [2, 1, 0],
      [0, 1, 0],
      [5, 1, 0],
    ];
    expect(routeBlockers(intoMachine, 0.1, scene).some((b) => b.id === "pump")).toBe(true);
    const route = planServiceRoute(
      "service",
      end([1, 1, 0], [1, 0, 0]),
      end([8, 1, 0], [-1, 0, 0]),
      routeStyle("electrical"),
      scene,
    );
    expect(route.state).toBe("clear");
  });
  it("checks rounded corners too, because a clear orthogonal polyline can cut a corner", () => {
    const points: V3[] = [
      [0, 1, 0],
      [2, 1, 0],
      [2, 1, 2],
    ];
    const scene = {
      ...empty,
      obstacles: [box("corner", [1.925, 1, 0.075], [0.025, 0.025, 0.025])],
    };
    expect(routeBlockers(points, 0.005, scene)).toEqual([]);
    expect(routeBlockers(filleted(points, 0.3), 0.005, scene).some((b) => b.id === "corner")).toBe(
      true,
    );
  });
  it("honors hollow cylinders and torus holes instead of rejecting their entire bounding boxes", () => {
    const geometry = cylinderGeometry(2, 4, "y", 0.01),
      t = transform(vec3(0, 3, 0));
    const vessel: RouteObstacle = {
      id: "vessel",
      label: "vessel",
      geometry,
      transform: t,
      bounds: worldAabb(geometry, t),
    };
    expect(distanceToRouteObstacle([0, 3, 0], vessel)).toBeGreaterThan(1);
    expect(
      routeBlockers(
        [
          [0, 2, 0],
          [0, 4, 0],
        ],
        0.05,
        { ...empty, obstacles: [vessel] },
      ),
    ).toEqual([]);
    expect(
      routeBlockers(
        [
          [-3, 3, 0],
          [3, 3, 0],
        ],
        0.05,
        { ...empty, obstacles: [vessel] },
      )[0]?.id,
    ).toBe("vessel");
    const ring = torusGeometry(3, 0.5),
      ringProxy = { ...vessel, geometry: ring, bounds: worldAabb(ring, t) };
    expect(
      routeBlockers(
        [
          [0, 1, 0],
          [0, 5, 0],
        ],
        0.1,
        { ...empty, obstacles: [ringProxy] },
      ),
    ).toEqual([]);
  });
  it("rechecks rotated/resized proxies in world space, including thin walls", () => {
    const obstacle = box("beam", [5, 1, 0], [4, 0.2, 0.2]);
    const points: V3[] = [
      [5, 0.5, -1],
      [5, 0.5, 1],
    ];
    expect(routeBlockers(points, 0.05, { ...empty, obstacles: [obstacle] })).toEqual([]);
    const t = transform(vec3(5, 1, 0), QuaternionMath.fromAxisAngle(vec3(0, 0, 1), Math.PI / 2));
    const rotated = { ...obstacle, transform: t, bounds: worldAabb(obstacle.geometry, t) };
    expect(routeBlockers(points, 0.05, { ...empty, obstacles: [rotated] })[0]?.id).toBe("beam");
  });
  it("keeps routes above a nonzero floor and never clamps a large declared bore smaller", () => {
    const route = planServiceRoute(
      "wire",
      end([0, 11, 0], [1, 0, 0]),
      end([8, 11, 0], [-1, 0, 0]),
      routeStyle("electrical"),
      { ...empty, groundM: 10 },
    );
    expect(route.state).toBe("clear");
    expect(Math.min(...route.points.map((p) => p[1] - route.radiusM))).toBeGreaterThanOrEqual(10);
    const port = {
      domain: "fluid",
      label: "OUT",
      direction: "out",
      fluid: "pressurized-water",
      innerDiameterM: 5,
      ratedPressurePa: 1e7,
      ratedTemperatureK: 600,
    } as const;
    expect(routeStyle("coolant", port).radiusM).toBe(2.53);
  });
  it("rejects nonlocal folds in a service's own occupied volume", () => {
    const points: V3[] = [
      [0, 1, 0],
      [4, 1, 0],
      [4, 1, 4],
      [0, 1, 4],
      [0, 1, -1],
    ];
    expect(routeBlockers(points, 0.07, empty).some((b) => b.kind === "self")).toBe(true);
  });
  it("handles an engineered terminal outside its overall envelope without infinite waypoints", () => {
    const scene = { ...empty, sourceId: "pump", obstacles: [box("pump", [0, 1, 0], [2, 2, 2])] };
    const route = planServiceRoute(
      "wire",
      end([1.1, 1, 0], [1, 0, 0]),
      end([8, 1, 0], [-1, 0, 0]),
      routeStyle("electrical"),
      scene,
    );
    expect(route.state).toBe("clear");
    expect(route.points.flat().every(Number.isFinite)).toBe(true);
  });
});
