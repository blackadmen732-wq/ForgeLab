import { describe, expect, it } from "vitest";
import { penetrations } from "./Cables.js";

describe("cryostat penetrations", () => {
  const shell = { x: 0, z: 0, r: 10, yMin: 0, yMax: 20 };

  it("marks where a run crosses the wall, facing along the run", () => {
    const hits = penetrations(
      [
        [0, 5, 0],
        [20, 5, 0],
      ],
      [shell],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.position[0]).toBeCloseTo(10, 4);
    expect(hits[0]!.normal[0]).toBeCloseTo(1, 9);
  });

  it("ignores runs that stay outside, or cross above the shell", () => {
    expect(
      penetrations(
        [
          [12, 5, 0],
          [20, 5, 0],
        ],
        [shell],
      ),
    ).toHaveLength(0);
    expect(
      penetrations(
        [
          [0, 30, 0],
          [20, 30, 0],
        ],
        [shell],
      ),
    ).toHaveLength(0);
  });
});
