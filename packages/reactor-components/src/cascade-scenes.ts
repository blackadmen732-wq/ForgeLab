import { MaterialIds, type MaterialId } from "@forgelab/materials";
import {
  type Vec3,
  celsiusToKelvin,
  kilowattHoursToJoules,
  megajoulesToJoules,
  megapascalsToPascals,
  transform,
  vec3,
} from "@forgelab/shared";
import {
  type CascadeNodeSpec,
  type CascadePlantSpec,
  type ComponentGeometry,
  type ConnectionType,
  type SimulationWorld,
  boxGeometry,
  connectionPoint,
  cylinderGeometry,
} from "@forgelab/sim-core";
import { getComponentDefinition } from "./builtin.js";

/**
 * How well a reference plant is engineered against failure.
 *
 * Each option is a real design decision — protection settings, layout, redundancy — not
 * a "survives" switch. The same single fault is induced in every variant; the physics
 * decides how far it travels.
 */
export interface CascadeDesign {
  /** Arc-fault protection: a low pickup and short delay that sees an arcing fault. */
  readonly fastArcProtection: boolean;
  /** Pump and cryoplant on their own feeder, so isolating one bus does not stop them. */
  readonly redundantFeeders: boolean;
  /** Batteries moved away from the switchgear behind an insulated fire barrier. */
  readonly separationAndBarrier: boolean;
  /** Inter-cell thermal barriers inside each battery module. */
  readonly cellBarriers: boolean;
  /** Relief valve on the coolant line; quench dump resistor; plasma auto-shutdown. */
  readonly processProtection: boolean;
}

export const UNPROTECTED_DESIGN: CascadeDesign = Object.freeze({
  fastArcProtection: false,
  redundantFeeders: false,
  separationAndBarrier: false,
  cellBarriers: false,
  processProtection: false,
});

export const PROTECTED_DESIGN: CascadeDesign = Object.freeze({
  fastArcProtection: true,
  redundantFeeders: true,
  separationAndBarrier: true,
  cellBarriers: true,
  processProtection: true,
});

/**
 * The reference cascade plant (docs/CASCADE.md §"Reference cascade").
 *
 * Central electrical equipment, nearby energy storage, a coolant line over the batteries,
 * a steel support carrying a pressurizer, a pump, a superconducting magnet with its
 * cryoplant, and a reactor chamber — all in one hall.
 *
 * Exactly one fault is induced: a bolted joint on the switchgear bus degrades and adds
 * 20 mΩ. Dimensions, inventories and ratings below are illustrative DESIGN INPUTS for a
 * small plant, chosen like a builder would choose them. None of them is a failure
 * probability, and none was tuned to make a particular component fail.
 */
export function buildReferenceCascade(
  world: SimulationWorld,
  design: CascadeDesign = UNPROTECTED_DESIGN,
): void {
  world.updateSettings({ failurePropagation: "detach" });
  const steel = MaterialIds.StructuralSteel;
  const batteryShift = design.separationAndBarrier ? 3.5 : 0;

  // --- Electrical ------------------------------------------------------------------
  part(
    world,
    "transformer",
    "Transformer",
    boxGeometry(vec3(2, 2.2, 1.6), 0.012),
    steel,
    vec3(-9, 1.1, 0),
    {
      additionalMassKg: 6000,
      sockets: [["e-out", vec3(1, 0, 0), vec3(1, 0, 0), "electrical"]],
    },
  );
  part(
    world,
    "breaker-a",
    "Breaker A",
    boxGeometry(vec3(0.5, 0.8, 0.4), 0.003),
    steel,
    vec3(-7.4, 0.4, -0.6),
    {
      sockets: [
        ["e-in", vec3(-0.25, 0, 0), vec3(-1, 0, 0), "electrical"],
        ["e-out", vec3(0.25, 0, 0), vec3(1, 0, 0), "electrical"],
      ],
    },
  );
  part(
    world,
    "switchgear",
    "Switchgear A",
    boxGeometry(vec3(1, 2.2, 0.8), 0.003),
    steel,
    vec3(-6, 1.1, 0),
    {
      sockets: [
        ["e-in", vec3(-0.5, 0, 0), vec3(-1, 0, 0), "electrical"],
        ["e-out", vec3(0.5, 0, 0), vec3(1, 0, 0), "electrical"],
      ],
    },
  );
  link(world, "transformer", "e-out", "breaker-a", "e-in");
  link(world, "breaker-a", "e-out", "switchgear", "e-in");

  if (design.redundantFeeders) {
    part(
      world,
      "breaker-b",
      "Breaker B",
      boxGeometry(vec3(0.5, 0.8, 0.4), 0.003),
      steel,
      vec3(-7.4, 0.4, 0.6),
      {
        sockets: [
          ["e-in", vec3(-0.25, 0, 0), vec3(-1, 0, 0), "electrical"],
          ["e-out", vec3(0.25, 0, 0), vec3(1, 0, 0), "electrical"],
        ],
      },
    );
    part(
      world,
      "switchgear-b",
      "Switchgear B",
      boxGeometry(vec3(1, 2.2, 0.8), 0.003),
      steel,
      vec3(-6, 1.1, -3),
      {
        sockets: [
          ["e-in", vec3(-0.5, 0, 0), vec3(-1, 0, 0), "electrical"],
          ["e-out", vec3(0.5, 0, 0), vec3(1, 0, 0), "electrical"],
        ],
      },
    );
    link(world, "transformer", "e-out", "breaker-b", "e-in");
    link(world, "breaker-b", "e-out", "switchgear-b", "e-in");
  }

  part(
    world,
    "aux-load",
    "Auxiliary load",
    boxGeometry(vec3(0.6, 0.6, 0.6), 0.003),
    steel,
    vec3(-6, 0.3, 2.5),
    {
      sockets: [["e-in", vec3(0, 0, -0.3), vec3(0, 0, -1), "electrical"]],
    },
  );
  link(world, "switchgear", "e-out", "aux-load", "e-in");

  // A PVC cable tray runs over the switchgear and the battery row, hung from the roof.
  // It is modelled as three 1.5 m sections so that fire can spread along it section by
  // section instead of the whole tray heating as one lump.
  for (const [i, x] of [
    [1, -6],
    [2, -4.5],
    [3, -3],
  ] as const) {
    part(
      world,
      `cable-tray-${i}`,
      `Cable tray section ${i}`,
      boxGeometry(vec3(1.5, 0.1, 0.6), 0.003),
      steel,
      vec3(x, 2.7, 0),
      { anchored: true },
    );
  }

  // --- Energy storage --------------------------------------------------------------
  for (const [id, x] of [
    ["battery-a", -4.2],
    ["battery-b", -2.6],
  ] as const) {
    part(
      world,
      id,
      id === "battery-a" ? "Battery module A" : "Battery module B",
      boxGeometry(vec3(1.2, 2, 0.8), 0.002),
      steel,
      vec3(x + batteryShift, 1, 0),
      { additionalMassKg: 16 * 3 },
    );
  }
  if (design.separationAndBarrier) {
    part(
      world,
      "fire-barrier",
      "Fire barrier",
      boxGeometry(vec3(0.12, 3.2, 3.0)),
      steel,
      vec3(-4.6, 1.6, 0),
      {},
    );
  }

  // --- Coolant: pipe over the batteries, pressurizer on a slender steel support ----
  part(
    world,
    "pipe-support",
    "Steel support",
    boxGeometry(vec3(0.06, 2.5, 0.06), 0.004),
    steel,
    vec3(-1.4, 1.25, 0),
    {
      sockets: [
        ["top", vec3(0, 1.25, 0), vec3(0, 1, 0), "structural"],
        ["bottom", vec3(0, -1.25, 0), vec3(0, -1, 0), "structural"],
      ],
    },
  );
  part(
    world,
    "pressurizer",
    "Pressurizer",
    boxGeometry(vec3(1, 1.4, 1), 0.02),
    steel,
    vec3(-1.4, 3.2, 0),
    {
      additionalMassKg: 14_000,
      sockets: [
        ["base", vec3(0, -0.7, 0), vec3(0, -1, 0), "structural"],
        ["coolant-in", vec3(-0.5, 0, 0), vec3(-1, 0, 0), "coolant"],
      ],
    },
  );
  world.connect(
    { componentId: "pressurizer", connectionPointId: "base" },
    { componentId: "pipe-support", connectionPointId: "top" },
  );
  part(
    world,
    "coolant-pipe",
    "Coolant line",
    cylinderGeometry(0.0445, 3.1, "x", 0.0055),
    steel,
    vec3(-3.45, 3.2, 0),
    {
      anchored: true,
      sockets: [["end-b", vec3(1.55, 0, 0), vec3(1, 0, 0), "coolant"]],
    },
  );
  world.connect(
    { componentId: "coolant-pipe", connectionPointId: "end-b" },
    { componentId: "pressurizer", connectionPointId: "coolant-in" },
    { type: "coolant" },
  );

  part(
    world,
    "pump",
    "Coolant pump",
    boxGeometry(vec3(1.2, 1.2, 1), 0.01),
    steel,
    vec3(2, 0.6, 0),
    {
      additionalMassKg: 800,
      sockets: [["e-in", vec3(-0.6, 0, 0), vec3(-1, 0, 0), "electrical"]],
    },
  );
  part(world, "cryoplant", "Cryoplant", boxGeometry(vec3(2, 2, 1.5), 0.005), steel, vec3(2, 1, 4), {
    additionalMassKg: 3000,
    sockets: [["e-in", vec3(-1, 0, 0), vec3(-1, 0, 0), "electrical"]],
  });
  // Pump and cryoplant run from Switchgear A. With redundant feeders they also have a
  // second feed from Switchgear B through an automatic transfer.
  link(world, "switchgear", "e-out", "pump", "e-in");
  link(world, "switchgear", "e-out", "cryoplant", "e-in");
  if (design.redundantFeeders) {
    link(world, "switchgear-b", "e-out", "pump", "e-in");
    link(world, "switchgear-b", "e-out", "cryoplant", "e-in");
  }

  // --- Magnet and reactor ------------------------------------------------------------
  part(
    world,
    "magnet",
    "Superconducting magnet",
    cylinderGeometry(1.2, 2, "y", 0.03),
    MaterialIds.StainlessSteel,
    vec3(7, 1, 4),
    { additionalMassKg: 2000 },
  );
  const chamber = getComponentDefinition("reactor-chamber");
  world.addComponent(
    chamber.createSpec({
      id: "reactor",
      transform: transform(vec3(7, 1.5, -2.5)),
      label: "Reactor chamber",
    }),
  );

  // --- Physics declarations ----------------------------------------------------------
  const nodes: CascadeNodeSpec[] = [
    {
      componentId: "transformer",
      electrical: {
        role: "source",
        nominalVoltageV: 400,
        arcingFaultCurrentA: 1500,
        arcVoltageV: 150,
      },
      combustible: { kind: "transformer-oil", massKg: 1200, burningAreaM2: 4 },
    },
    {
      componentId: "breaker-a",
      electrical: design.fastArcProtection
        ? { role: "breaker", pickupCurrentA: 1200, tripDelaySec: 0.1 }
        : { role: "breaker", pickupCurrentA: 4000, tripDelaySec: 0.5 },
    },
    { componentId: "switchgear", electrical: busConductor() },
    { componentId: "aux-load", electrical: { role: "load", powerW: 200_000 } },
    ...[1, 2, 3].map((i) => ({
      componentId: `cable-tray-${i}`,
      combustible: { kind: "pvc-insulation" as const, massKg: 20, burningAreaM2: 1 },
    })),
    batteryNode("battery-a", design),
    batteryNode("battery-b", design),
    { componentId: "pipe-support" },
    { componentId: "pressurizer" },
    {
      componentId: "coolant-pipe",
      initialTemperatureK: celsiusToKelvin(150),
      pipe: {
        loopId: "primary",
        waterMassKg: 13.6,
        flowCoolingWPerK: 1500,
        blockedIn: true,
        breachAreaM2: 0.005,
        flangeSeparationLimitM: 0.05,
        ...(design.processProtection ? { reliefSetPressurePa: megapascalsToPascals(2) } : {}),
      },
    },
    {
      componentId: "pump",
      electrical: { role: "load", powerW: 90_000 },
      pump: { loopId: "primary", ratedFlowKgPerSec: 30, coastdownTimeConstantSec: 15 },
    },
    {
      componentId: "cryoplant",
      electrical: { role: "load", powerW: 150_000 },
      cryoplant: { cryostatComponentId: "magnet", refrigerationW: 600 },
    },
    {
      componentId: "magnet",
      cryostat: { heliumInventoryKg: 4, heatLeakConductanceWPerK: 2, coldMassKg: 2000 },
      magnet: {
        cryostatComponentId: "magnet",
        storedEnergyJ: megajoulesToJoules(200),
        operatingCurrentA: 40_000,
        currentSharingTemperatureK: 6.5,
        dumpResistanceOhm: design.processProtection ? 0.25 : 0,
        quenchDetectionDelaySec: 0.5,
        unprotectedDecayTimeSec: 5,
      },
    },
    {
      componentId: "reactor",
      initialTemperatureK: celsiusToKelvin(250),
      cooledLoad: { loopId: "primary", heatGenerationW: 0, coolingWPerK: 20_000 },
      plasma: {
        magnetComponentId: "magnet",
        storedThermalEnergyJ: megajoulesToJoules(50),
        wallHeatingW: 2_000_000,
        minimumFieldFraction: 0.8,
        disruptionWettedAreaFraction: 0.05,
        thermalQuenchDurationSec: 0.002,
        radiationPowerW: 50_000,
        ...(design.processProtection
          ? {
              controlledShutdown: {
                onCoolantFlowFractionBelow: 0.5,
                onFieldFractionBelow: 0.95,
                onWallTemperatureAboveK: celsiusToKelvin(400),
                rampDownSec: 10,
              },
            }
          : {}),
      },
    },
  ];
  if (design.redundantFeeders) {
    nodes.push(
      {
        componentId: "breaker-b",
        electrical: { role: "breaker", pickupCurrentA: 1200, tripDelaySec: 0.1 },
      },
      { componentId: "switchgear-b", electrical: { ...busConductor() } },
    );
  }
  if (design.separationAndBarrier) {
    nodes.push({
      componentId: "fire-barrier",
      barrier: {
        insulationThicknessM: 0.1,
        insulationConductivityWmK: 0.1,
        insulationDensityKgM3: 150,
        insulationSpecificHeatJkgK: 840,
        overpressureCapacityPa: 20_000,
      },
    });
  }

  const plant: CascadePlantSpec = {
    ambientTemperatureK: celsiusToKelvin(20),
    nodes,
    coolantLoops: [
      {
        id: "primary",
        inventoryKg: 14_000,
        supplyTemperatureK: celsiusToKelvin(150),
        operatingPressurePa: megapascalsToPascals(1.5),
        minimumInventoryFraction: 0.3,
      },
    ],
    enclosures: [
      {
        id: "hall",
        minM: vec3(-12, 0, -6),
        maxM: vec3(12, 8, 7),
        airChangesPerHour: 2,
        ...(design.processProtection ? { ventReliefPressurePa: 5000 } : {}),
      },
    ],
    faults: [
      {
        kind: "high-resistance-joint",
        componentId: "switchgear",
        atTimeSec: 1,
        addedResistanceOhm: 0.02,
      },
    ],
  };
  world.setCascadePlant(plant);
  world.solve();
}

/** Bus conductor inside a switchgear cabinet, with PVC-insulated wiring. */
function busConductor() {
  return {
    role: "conductor" as const,
    lengthM: 6,
    conductorAreaM2: 2.4e-4,
    conductorMaterialId: "copper" as const,
    insulation: "pvc" as const,
    insulationMassKg: 40,
    insulationBurningAreaM2: 4,
    conductorToShellConductanceWPerK: 5,
    burnClearLengthM: 6,
  };
}

function batteryNode(componentId: string, design: CascadeDesign): CascadeNodeSpec {
  return {
    componentId,
    battery: {
      chemistry: "nmc",
      cellCount: 16,
      cellMassKg: 3,
      cellEnergyJ: kilowattHoursToJoules(0.5),
      stateOfCharge: 0.9,
      interCellConductanceWPerK: design.cellBarriers ? 0.1 : 2,
      cabinetToCellConductanceWPerK: 1,
      cabinetToEndCellConductanceWPerK: 5,
      crushToleranceJ: 2000,
    },
  };
}

type SocketDef = readonly [id: string, local: Vec3, direction: Vec3, type: ConnectionType];

function part(
  world: SimulationWorld,
  id: string,
  label: string,
  geometry: ComponentGeometry,
  materialId: MaterialId,
  position: Vec3,
  options: { additionalMassKg?: number; anchored?: boolean; sockets?: readonly SocketDef[] },
): void {
  world.addComponent({
    id,
    type: "plant-equipment",
    label,
    geometry,
    materialId,
    transform: transform(position),
    connectionPoints: (options.sockets ?? []).map(([sid, local, dir, type]) =>
      connectionPoint(sid, local, dir, type),
    ),
    ...(options.additionalMassKg === undefined
      ? {}
      : { additionalMassKg: options.additionalMassKg }),
    ...(options.anchored === undefined ? {} : { anchored: options.anchored }),
  });
}

function link(
  world: SimulationWorld,
  a: string,
  aSocket: string,
  b: string,
  bSocket: string,
): void {
  world.connect(
    { componentId: a, connectionPointId: aSocket },
    { componentId: b, connectionPointId: bSocket },
    { type: "electrical" },
  );
}
