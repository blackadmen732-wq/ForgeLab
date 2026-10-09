import type { ConnectionType, PlantRole } from "@forgelab/sim-core";

/**
 * Plant systems: how an engineer groups a plant's hardware (structure, the reactor core,
 * magnets, cooling, vacuum ...). Derived from each part's engineering role and, for
 * pipework and pumps, from the fluid it carries — never stored separately, so a part
 * cannot sit in the wrong system. Organisation and presentation only: nothing here feeds
 * the simulation.
 */
export type PlantSystem =
  | "structure"
  | "reactor"
  | "magnets"
  | "cryogenics"
  | "cooling"
  | "vacuum"
  | "heating"
  | "fuel"
  | "electrical"
  | "controls"
  | "power-conversion";

/** Display order, outermost load path first, as a plant breakdown is usually drawn. */
export const PLANT_SYSTEMS: readonly PlantSystem[] = [
  "structure",
  "reactor",
  "magnets",
  "cryogenics",
  "cooling",
  "vacuum",
  "heating",
  "fuel",
  "electrical",
  "controls",
  "power-conversion",
];

export const PLANT_SYSTEM_LABELS: Readonly<Record<PlantSystem, string>> = {
  structure: "Structure",
  reactor: "Reactor core",
  magnets: "Magnets",
  cryogenics: "Cryogenics",
  cooling: "Cooling",
  vacuum: "Vacuum",
  heating: "Heating",
  fuel: "Fuel",
  electrical: "Electrical",
  controls: "Controls",
  "power-conversion": "Power conversion",
};

const BY_ROLE: Readonly<Record<PlantRole, PlantSystem>> = {
  structure: "structure",
  "vacuum-vessel": "reactor",
  blanket: "reactor",
  "magnet-coil": "magnets",
  "fuel-injector": "fuel",
  "plasma-heater": "heating",
  "vacuum-pump": "vacuum",
  "power-supply": "electrical",
  conductor: "electrical",
  switch: "electrical",
  "coolant-pipe": "cooling",
  "coolant-pump": "cooling",
  "heat-exchanger": "power-conversion",
  turbine: "power-conversion",
  generator: "power-conversion",
  sensor: "controls",
  controller: "controls",
};

/**
 * The system a part belongs to. Pipework and pumps carrying a cryogenic fluid are
 * cryogenics; a gas-cooled loop's warm helium is ordinary cooling.
 */
export function plantSystemOf(part: {
  readonly role: PlantRole;
  readonly parameters: Readonly<Record<string, unknown>>;
}): PlantSystem {
  const system = BY_ROLE[part.role];
  if (system === "cooling") {
    const fluid = part.parameters["fluid"];
    if (typeof fluid === "string" && fluid.startsWith("cryogenic")) return "cryogenics";
  }
  return system;
}

/** The system a connection's run (cable, pipe, duct, shaft) belongs to. */
export function plantSystemOfConnection(type: ConnectionType): PlantSystem {
  switch (type) {
    case "structural":
    case "mount":
      return "structure";
    case "electrical":
      return "electrical";
    case "coolant":
      return "cooling";
    case "cryo":
      return "cryogenics";
    case "steam":
    case "shaft":
      return "power-conversion";
    case "vacuum":
      return "vacuum";
    case "fuel":
      return "fuel";
    case "control":
      return "controls";
    case "port":
      return "heating";
  }
}
