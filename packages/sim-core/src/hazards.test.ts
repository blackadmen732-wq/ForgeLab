import { describe, expect, it } from "vitest";
import { vec3 } from "@forgelab/shared";
import {
  type HazardBody,
  equivalentRadiusM,
  fireRadiationAbsorbedW,
  ShadowIndex,
  hazardPairs,
  occlusionTransmission,
  pairGeometry,
  radiantExchangeW,
} from "./index.js";

const body = (id: string, x: number, radiusM: number, y = 0): HazardBody => ({
  id,
  centreM: vec3(x, y, 0),
  radiusM,
  areaM2: 4 * Math.PI * radiusM ** 2,
});

describe("spatial hazards", () => {
  it("an equivalent sphere keeps the part's surface area", () => {
    expect(4 * Math.PI * equivalentRadiusM(3.26) ** 2).toBeCloseTo(3.26, 9);
  });

  it("exchange is reciprocal and falls with the square of distance", () => {
    const a = body("a", 0, 0.5);
    const b = body("b", 3, 0.2);
    const ab = pairGeometry(a, b)!;
    const ba = pairGeometry(b, a)!;
    expect(ab.exchangeAreaM2).toBeCloseTo(ba.exchangeAreaM2, 12);
    const far = pairGeometry(a, body("b", 6, 0.2))!;
    expect(ab.exchangeAreaM2 / far.exchangeAreaM2).toBeCloseTo(4, 9);
    // Net flow runs hot to cold and reverses with the temperatures.
    expect(radiantExchangeW(ab.exchangeAreaM2, 1000, 300)).toBeGreaterThan(0);
    expect(radiantExchangeW(ab.exchangeAreaM2, 300, 1000)).toBeCloseTo(
      -radiantExchangeW(ab.exchangeAreaM2, 1000, 300),
      9,
    );
  });

  it("overlapping parts are held at touching distance; a part inside another is skipped", () => {
    const touching = pairGeometry(body("a", 0, 0.5), body("b", 0.3, 0.5))!;
    expect(touching.distanceM).toBeCloseTo(1, 12);
    expect(pairGeometry(body("big", 0, 10), body("inside", 2, 1))).toBeNull();
  });

  it("flame radiation follows the point-source model", () => {
    // χr = 0.35 of 1 MW over 4π d², intercepted by π r² and absorbed with ε = 0.3.
    const w = fireRadiationAbsorbedW(1e6, 0.2, 2);
    expect(w).toBeCloseTo((0.3 * 0.35 * 1e6 * Math.PI * 0.04) / (4 * Math.PI * 4), 6);
  });

  it("pairs are found by the broad phase exactly as by brute force, in a fixed order", () => {
    const bodies: HazardBody[] = [];
    for (let i = 0; i < 40; i += 1)
      bodies.push(
        body(`p${String(i).padStart(2, "0")}`, (i * 37) % 90, 0.1 + (i % 5) * 0.3, (i * 13) % 20),
      );
    bodies.push(body("hall-sized", 40, 15));
    const pairs = hazardPairs(bodies);
    const brute: string[] = [];
    for (let i = 0; i < bodies.length; i += 1)
      for (let j = i + 1; j < bodies.length; j += 1) {
        const [a, b] = [bodies[i]!, bodies[j]!].sort((x, y) => (x.id < y.id ? -1 : 1));
        if (pairGeometry(a!, b!) !== null) brute.push(`${a!.id}|${b!.id}`);
      }
    expect(pairs.map((p) => `${p.a}|${p.b}`)).toEqual(brute.sort());
    expect(hazardPairs([...bodies].reverse())).toEqual(pairs);
    // Small parts far apart are never coupled.
    expect(pairs.some((p) => p.a === "p00" && p.b === "p01")).toBe(false);
  });

  describe("shadowing by parts in between", () => {
    const fire = body("fire", 0, 0.5);
    const target = body("target", 4, 0.5);

    it("a part as wide as the beam blocks it completely", () => {
      const wall = body("wall", 2, 1);
      const { transmission, shadowedBy } = occlusionTransmission(fire, target, [
        fire,
        target,
        wall,
      ]);
      expect(transmission).toBe(0);
      expect(shadowedBy).toEqual(["wall"]);
      expect(new ShadowIndex([fire, target, wall]).between("target", "fire").transmission).toBe(0);
    });

    it("a slender part blocks only its share, (r_c / r_small)²", () => {
      const rod = body("rod", 2, 0.1);
      const { transmission } = occlusionTransmission(fire, target, [rod]);
      expect(transmission).toBeCloseTo(1 - (0.1 / 0.5) ** 2, 12);
      expect(new ShadowIndex([fire, target, rod]).between("fire", "target").transmission).toBe(
        transmission,
      );
    });

    it("a part beside the line of sight, behind either end, or enclosing an end is no shadow", () => {
      expect(occlusionTransmission(fire, target, [body("beside", 2, 0.5, 3)]).transmission).toBe(1);
      expect(occlusionTransmission(fire, target, [body("behind", 6, 1)]).transmission).toBe(1);
      expect(occlusionTransmission(fire, target, [body("room", 2, 20)]).transmission).toBe(1);
    });

    it("is symmetric, so radiant exchange stays reciprocal", () => {
      const rod = body("rod", 1.5, 0.2, 0.1);
      expect(occlusionTransmission(fire, target, [rod]).transmission).toBeCloseTo(
        occlusionTransmission(target, fire, [rod]).transmission,
        12,
      );
    });
  });

  describe("walls and slabs block with their true extent", () => {
    const panel = (
      id: string,
      centre: [number, number, number],
      half: [number, number, number],
    ) => ({
      ...body(
        id,
        centre[0],
        equivalentRadiusM(8 * (half[0] * half[1] + half[1] * half[2] + half[0] * half[2])),
        centre[1],
      ),
      centreM: vec3(...centre),
      box: {
        frame: { positionM: vec3(...centre), rotation: { x: 0, y: 0, z: 0, w: 1 } },
        halfM: vec3(...half),
      },
    });
    const fire = body("fire", 0, 0.5, 1);
    const target = body("target", 6, 0.5, 1);

    it("a thin wall across the line blocks it, however small its equivalent sphere", () => {
      // 0.2 m thick, 4 m high, 8 m long: its equivalent sphere would barely shade the pair.
      const wall = panel("wall", [3, 2, 0], [0.1, 2, 4]);
      const { transmission, shadowedBy } = occlusionTransmission(fire, target, [wall]);
      expect(transmission).toBe(0);
      expect(shadowedBy).toEqual(["wall"]);
    });

    it("a wall too low or off to the side leaves the line partly or fully open", () => {
      const low = panel("low", [3, 0.25, 0], [0.1, 0.25, 4]);
      expect(occlusionTransmission(fire, target, [low]).transmission).toBe(1);
      const beside = panel("beside", [3, 2, 6], [0.1, 2, 1]);
      expect(occlusionTransmission(fire, target, [beside]).transmission).toBe(1);
      // A wall whose top edge cuts through the beam blocks the lower part of it.
      const half = panel("half", [3, 0.5, 0], [0.1, 0.55, 4]);
      const t = occlusionTransmission(fire, target, [half]).transmission;
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(1);
    });

    it("a floor slab separates the storeys above and below it", () => {
      const below = body("below", 0, 0.5, 1);
      const above = body("above", 0.5, 0.5, 6);
      const slab = panel("slab", [0, 3, 0], [5, 0.15, 5]);
      expect(occlusionTransmission(below, above, [slab]).transmission).toBe(0);
      expect(occlusionTransmission(above, below, [slab]).transmission).toBe(0);
    });

    it("parts inside a box (a room, an enclosure) are not shadowed by it", () => {
      const room = panel("room", [3, 2, 0], [6, 3, 6]);
      expect(occlusionTransmission(fire, target, [room]).transmission).toBe(1);
    });

    it("the ground is opaque: no sight line slips under a wall standing on it", () => {
      const lowFire = body("fire", 0, 1, 0.3);
      const lowTarget = body("target", 6, 1, 0.3);
      const wall = panel("wall", [3, 2, 0], [0.1, 2, 4]);
      expect(occlusionTransmission(lowFire, lowTarget, [wall]).transmission).toBeGreaterThan(0);
      expect(occlusionTransmission(lowFire, lowTarget, [wall], 0).transmission).toBe(0);
      const index = new ShadowIndex([lowFire, lowTarget, wall], 4, 0);
      expect(index.between("fire", "target").transmission).toBe(0);
    });
  });
});
