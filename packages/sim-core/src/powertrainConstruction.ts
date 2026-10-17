import { vec3, type Vec3 } from "@forgelab/shared";
import type { SimulationComponent } from "./component.js";

/** Stock construction capabilities. These retain the existing lumped machine models;
 * modules are meaningful authored objects, not independent design-performance solvers.
 */
export interface ConstructionRecipe {
  readonly id: string;
  readonly name: string;
  readonly resultType: string;
  readonly role: SimulationComponent["role"];
  readonly materialId: NonNullable<SimulationComponent["materialId"]>;
  readonly size: Vec3;
  readonly thicknessM: number;
  readonly parameters: Readonly<Record<string, number | boolean | string>>;
  readonly modelPart: string;
  readonly readouts: {
    readonly electrical: string | null;
    readonly coolant: string | null;
    readonly outputs: string;
  };
  readonly parts: readonly {
    readonly key: string;
    readonly type: string;
    readonly name: string;
    readonly purpose?: string;
    readonly offset: Vec3;
    readonly size: Vec3;
  }[];
  readonly joints: readonly {
    readonly from: readonly [string, string];
    readonly to: readonly [string, string];
    readonly position: Vec3;
    readonly direction: Vec3;
  }[];
  readonly externalPorts: Readonly<Record<string, readonly [string, string]>>;
}

export const GENERATOR_CONSTRUCTION_RECIPE: ConstructionRecipe = {
  id: "generator-kit-v1",
  name: "Modular Generator",
  resultType: "generator",
  role: "generator",
  materialId: "structural-steel",
  size: vec3(6, 4, 4),
  thicknessM: 0.05,
  parameters: {},
  modelPart: "casing",
  readouts: { electrical: "terminals", coolant: null, outputs: "rotor" },
  parts: [
    {
      key: "base",
      type: "generator-base",
      name: "Generator bedplate",
      purpose: "Supports the stator and holds the shaft alignment.",
      offset: vec3(0, -1.25, 0),
      size: vec3(6, 1.5, 3.6),
    },
    {
      key: "casing",
      type: "generator-stator",
      name: "Stator / housing",
      purpose: "Stationary winding housing around the turning rotor.",
      offset: vec3(0, 0.2, 0),
      size: vec3(4.8, 3.6, 3.6),
    },
    {
      key: "rotor",
      type: "generator-rotor",
      name: "Rotor / bearings",
      purpose: "Receives shaft power from the turbine; rotates inside the stator.",
      offset: vec3(0, 0, 0),
      size: vec3(6, 2.3, 2.3),
    },
    {
      key: "terminals",
      type: "generator-terminal-module",
      name: "Terminal / exciter module",
      purpose: "Owns the electrical output connection to the plant bus.",
      offset: vec3(2.1, 0.4, 0),
      size: vec3(1.8, 2.4, 2),
    },
  ],
  joints: [
    {
      from: ["base", "stator-seat"],
      to: ["casing", "base"],
      position: vec3(0, -1.5, 0),
      direction: vec3(0, 1, 0),
    },
    {
      from: ["base", "rotor-seat"],
      to: ["rotor", "stator-mate"],
      position: vec3(-2.58, -0.57, 0),
      direction: vec3(0, 1, 0),
    },
    {
      from: ["casing", "terminal-seat"],
      to: ["terminals", "stator-mate"],
      position: vec3(2.1, -0.225, 0),
      direction: vec3(0, 1, 0),
    },
  ],
  externalPorts: {
    base: ["base", "base"],
    shaft: ["rotor", "shaft"],
    power: ["terminals", "power"],
  },
};

export const TURBINE_CONSTRUCTION_RECIPE: ConstructionRecipe = {
  id: "steam-turbine-kit-v1",
  name: "Modular Steam Turbine",
  resultType: "steam-turbine",
  role: "turbine",
  materialId: "structural-steel",
  size: vec3(10, 4, 4),
  thicknessM: 0.05,
  parameters: {},
  modelPart: "casing",
  readouts: { electrical: null, coolant: null, outputs: "rotor" },
  parts: [
    {
      key: "base",
      type: "turbine-base",
      name: "Turbine bedplate",
      purpose: "Supports the casing and bearing pedestals.",
      offset: vec3(0, -1.25, 0),
      size: vec3(10, 1.5, 3.6),
    },
    {
      key: "casing",
      type: "turbine-casing",
      name: "Split turbine casing",
      purpose: "Contains the steam expansion path around the bladed rotor.",
      offset: vec3(0, 0.2, 0),
      size: vec3(8, 3.6, 3.6),
    },
    {
      key: "rotor",
      type: "turbine-rotor",
      name: "Bladed rotor / bearings",
      purpose: "Transfers the existing model's steam-derived shaft power to a generator.",
      offset: vec3(0, 0, 0),
      size: vec3(10, 2.6, 2.6),
    },
    {
      key: "chest",
      type: "turbine-steam-chest",
      name: "Steam chest / inlet",
      purpose: "Owns the steam connection from the steam generator.",
      offset: vec3(-3.6, 0.4, 0),
      size: vec3(2.8, 2.4, 3.6),
    },
  ],
  joints: [
    {
      from: ["base", "casing-seat"],
      to: ["casing", "base"],
      position: vec3(0, -1.5, 0),
      direction: vec3(0, 1, 0),
    },
    {
      from: ["base", "rotor-seat"],
      to: ["rotor", "casing-mate"],
      position: vec3(4.3, -0.57, 0),
      direction: vec3(0, 1, 0),
    },
    {
      from: ["casing", "chest-seat"],
      to: ["chest", "casing-mate"],
      position: vec3(-3.6, -0.3, 0),
      direction: vec3(0, 1, 0),
    },
  ],
  externalPorts: { base: ["base", "base"], steam: ["chest", "steam"], shaft: ["rotor", "shaft"] },
};
