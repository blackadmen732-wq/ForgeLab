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
});
