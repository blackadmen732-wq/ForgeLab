import { describe, expect, it } from "vitest";
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
  type BatterySpec,
  type CascadeEventKind,
  type CascadeNodeSpec,
  type CascadePlantSpec,
  type ComponentGeometry,
  type ConnectionType,
  type InducedFaultSpec,
  SimulationWorld,
  boxGeometry,
  connectionPoint,
  cylinderGeometry,
} from "../index.js";

/* ------------------------------------------------------------------------------------ *
 * Small-scene helpers
 * ------------------------------------------------------------------------------------ */

type Socket = readonly [string, Vec3, Vec3, ConnectionType];

function part(
  world: SimulationWorld,
  id: string,
  geometry: ComponentGeometry,
  position: Vec3,
  options: {
    materialId?: MaterialId;
    anchored?: boolean;
    additionalMassKg?: number;
    sockets?: readonly Socket[];
  } = {},
): void {
  world.addComponent({
    id,
    type: "test-part",
    geometry,
    materialId: options.materialId ?? MaterialIds.StructuralSteel,
    transform: transform(position),
    connectionPoints: (options.sockets ?? []).map(([sid, p, d, t]) =>
      connectionPoint(sid, p, d, t),
    ),
    anchored: options.anchored ?? true,
    ...(options.additionalMassKg === undefined
      ? {}
      : { additionalMassKg: options.additionalMassKg }),
  });
}

function plant(
  nodes: CascadeNodeSpec[],
  extras: Pick<CascadePlantSpec, "faults" | "enclosures" | "coolantLoops"> = {},
): CascadePlantSpec {
  return { ambientTemperatureK: celsiusToKelvin(20), nodes, ...extras };
}

function kinds(world: SimulationWorld): CascadeEventKind[] {
  return world.getSnapshot().cascade!.events.map((e) => e.kind);
}

function eventsOf(world: SimulationWorld, componentId: string) {
  return world.getSnapshot().cascade!.events.filter((e) => e.componentId === componentId);
}

function node(world: SimulationWorld, id: string) {
  return world.getSnapshot().cascade!.nodes.find((n) => n.componentId === id)!;
}

function nmcModule(
  cells: number,
  interCell: number,
  chemistry: "nmc" | "lfp" = "nmc",
): BatterySpec {
  return {
    chemistry,
    cellCount: cells,
    cellMassKg: 3,
    cellEnergyJ: kilowattHoursToJoules(0.5),
    stateOfCharge: 0.9,
    interCellConductanceWPerK: interCell,
    cabinetToCellConductanceWPerK: 1,
    crushToleranceJ: 2000,
  };
}

const seconds = (s: number) => Math.round(s * 60);

/* ------------------------------------------------------------------------------------ */

describe("cascade: distance alone never causes failure", () => {
  it("leaves a battery untouched beside a structurally failed part that emits nothing", () => {
    const world = new SimulationWorld({ settings: { failurePropagation: "detach" } });
    // A copper post grossly overloaded: it yields immediately, but yielding releases no heat.
    part(world, "post", boxGeometry(vec3(0.05, 1, 0.05)), vec3(0, 0.5, 0), {
      materialId: MaterialIds.Copper,
      anchored: false,
      sockets: [["top", vec3(0, 0.5, 0), vec3(0, 1, 0), "structural"]],
    });
    part(world, "load", boxGeometry(vec3(0.5, 0.5, 0.5)), vec3(0, 1.25, 0), {
      anchored: false,
      additionalMassKg: 30_000,
      sockets: [["base", vec3(0, -0.25, 0), vec3(0, -1, 0), "structural"]],
    });
    world.connect(
      { componentId: "load", connectionPointId: "base" },
      { componentId: "post", connectionPointId: "top" },
    );
    part(world, "battery", boxGeometry(vec3(0.6, 1, 0.4), 0.002), vec3(0.6, 0.5, 0));
    world.setCascadePlant(
      plant([{ componentId: "battery", battery: nmcModule(4, 2) }, { componentId: "post" }]),
    );
    world.stepMany(seconds(60));

    expect(world.getSnapshot().failures.some((f) => f.componentId === "post")).toBe(true);
    expect(eventsOf(world, "battery")).toEqual([]);
    expect(node(world, "battery").battery!.cellStates.every((s) => s === "normal")).toBe(true);
    expect(node(world, "battery").temperatureK).toBeCloseTo(celsiusToKelvin(20), 3);
  });
});

describe("cascade: radiant heat and shielding", () => {
  function scene(withBarrier: boolean): SimulationWorld {
    const world = new SimulationWorld();
    part(world, "heater", boxGeometry(vec3(0.5, 0.5, 0.5)), vec3(0, 1, 0));
    part(world, "target", boxGeometry(vec3(0.5, 0.5, 0.5), 0.005), vec3(2, 1, 0));
    const nodes: CascadeNodeSpec[] = [
      { componentId: "heater", initialTemperatureK: 1200 },
      { componentId: "target" },
    ];
    if (withBarrier) {
      part(world, "wall", boxGeometry(vec3(0.1, 2, 2)), vec3(1, 1, 0));
      nodes.push({
        componentId: "wall",
        barrier: {
          insulationThicknessM: 0.1,
          insulationConductivityWmK: 0.1,
          insulationDensityKgM3: 150,
          insulationSpecificHeatJkgK: 840,
        },
      });
    }
    world.setCascadePlant(plant(nodes));
    world.stepMany(seconds(120));
    return world;
  }

  it("heats a nearby part only through radiation the hot part actually emits", () => {
    const open = scene(false);
    const exposure = open.getSnapshot().cascade!.exposures.find((e) => e.componentId === "target")!;
    // A 1200 K steel block 1.5 m away: a few kW/m², warming a 59 kg shell by a few kelvin.
    expect(exposure.radiantHeatFluxWm2).toBeGreaterThan(1000);
    expect(node(open, "target").temperatureK).toBeGreaterThan(celsiusToKelvin(22));
  });

  it("is blocked by a barrier on the line of sight", () => {
    const open = scene(false);
    const shielded = scene(true);
    expect(node(shielded, "target").temperatureK - 293.15).toBeLessThan(
      (node(open, "target").temperatureK - 293.15) * 0.05,
    );
  });
});

describe("cascade: melting is not gas generation", () => {
  it("melts copper through latent heat and releases nothing into the room", () => {
    const world = new SimulationWorld();
    part(world, "bar", boxGeometry(vec3(0.1, 0.1, 0.1)), vec3(0, 1, 0), {
      materialId: MaterialIds.Copper,
    });
    world.setCascadePlant(
      plant([{ componentId: "bar" }], {
        faults: [
          {
            kind: "external-heat",
            componentId: "bar",
            atTimeSec: 0,
            powerW: 60_000,
            durationSec: 120,
          },
        ],
        enclosures: [
          { id: "room", minM: vec3(-3, 0, -3), maxM: vec3(3, 3, 3), airChangesPerHour: 0 },
        ],
      }),
    );
    let sawPlateau = false;
    for (let i = 0; i < seconds(120); i += 1) {
      world.step();
      const t = world.cascade!.temperatureOf("bar")!;
      const n = node(world, "bar");
      if (n.liquidFraction > 0.1 && n.liquidFraction < 0.9) {
        sawPlateau = true;
        expect(t).toBeCloseTo(1357.77, 6);
      }
      if (n.liquidFraction >= 1) break;
    }
    expect(sawPlateau).toBe(true);
    expect(kinds(world)).toContain("melting-began");
    expect(kinds(world)).toContain("melted-through");
    expect(kinds(world)).not.toContain("decomposition");
    const gas = world.cascade!.enclosureGas("room")!;
    expect(Object.values(gas).every((kg) => kg === 0)).toBe(true);
  });
});

describe("cascade: fire spreads only to combustible material", () => {
  function scene() {
    const world = new SimulationWorld();
    part(world, "oil-pan", boxGeometry(vec3(1.5, 0.3, 1.5), 0.005), vec3(0, 0.15, 0));
    part(world, "beam", boxGeometry(vec3(2, 0.15, 0.15), 0.008), vec3(0, 1.2, 0));
    part(world, "cable", boxGeometry(vec3(2, 0.1, 0.4), 0.003), vec3(0, 1.6, 0.6));
    world.setCascadePlant(
      plant(
        [
          {
            componentId: "oil-pan",
            combustible: { kind: "transformer-oil", massKg: 40, burningAreaM2: 2 },
          },
          { componentId: "beam" },
          {
            componentId: "cable",
            combustible: { kind: "pvc-insulation", massKg: 10, burningAreaM2: 0.8 },
          },
        ],
        {
          faults: [
            {
              kind: "external-heat",
              componentId: "oil-pan",
              atTimeSec: 0,
              powerW: 300_000,
              durationSec: 240,
            },
            { kind: "pilot-flame", componentId: "oil-pan", atTimeSec: 0, durationSec: 240 },
          ],
        },
      ),
    );
    world.stepMany(seconds(400));
    return world;
  }

  it("evaporates heated oil without a pilot instead of letting it reach auto-ignition", () => {
    const world = new SimulationWorld();
    part(world, "oil-pan", boxGeometry(vec3(1.5, 0.3, 1.5), 0.005), vec3(0, 0.15, 0));
    world.setCascadePlant(
      plant(
        [
          {
            componentId: "oil-pan",
            combustible: { kind: "transformer-oil", massKg: 40, burningAreaM2: 2 },
          },
        ],
        {
          faults: [
            {
              kind: "external-heat",
              componentId: "oil-pan",
              atTimeSec: 0,
              powerW: 300_000,
              durationSec: 90,
            },
          ],
        },
      ),
    );
    world.stepMany(seconds(200));
    expect(kinds(world)).toContain("decomposition");
    expect(kinds(world)).not.toContain("ignition");
    expect(node(world, "oil-pan").temperatureK).toBeLessThan(celsiusToKelvin(310));
  });

  it("heats and weakens steel without ever setting it alight, while cable insulation ignites", () => {
    const world = scene();
    const events = world.getSnapshot().cascade!.events;
    const oil = events.find((e) => e.kind === "ignition" && e.componentId === "oil-pan");
    expect(oil).toBeDefined();

    expect(
      events.some(
        (e) => e.componentId === "beam" && (e.kind === "ignition" || e.kind === "decomposition"),
      ),
    ).toBe(false);
    expect(node(world, "beam").temperatureK).toBeGreaterThan(celsiusToKelvin(300));
    expect(node(world, "beam").conditions).not.toContain("burning");

    const cable = events.find((e) => e.kind === "ignition" && e.componentId === "cable");
    expect(cable).toBeDefined();
    expect(world.cascade!.ancestorsOf(cable!.id)).toContain(oil!.id);
  });
});

describe("cascade: battery thermal runaway propagation", () => {
  function moduleRun(interCell: number) {
    const world = new SimulationWorld();
    part(world, "module", boxGeometry(vec3(1, 0.6, 0.4), 0.002), vec3(0, 0.3, 0));
    world.setCascadePlant(
      plant([{ componentId: "module", battery: nmcModule(4, interCell) }], {
        faults: [
          { kind: "cell-internal-short", componentId: "module", atTimeSec: 1, cellIndex: 0 },
        ],
      }),
    );
    world.stepMany(seconds(900));
    return world;
  }

  it("propagates cell to cell through conduction when cells are tightly coupled", () => {
    const world = moduleRun(4);
    const states = node(world, "module").battery!.cellStates;
    expect(states.every((s) => s === "runaway" || s === "burned-out")).toBe(true);
    const events = eventsOf(world, "module");
    const first = events.find((e) => e.kind === "thermal-runaway")!;
    const propagated = events.filter((e) => e.kind === "runaway-propagated");
    expect(propagated.length).toBe(3);
    // Each propagation happens later in time and traces back to the first runaway.
    for (const p of propagated) {
      expect(p.timeSec).toBeGreaterThan(first.timeSec);
      expect(world.cascade!.ancestorsOf(p.id)).toContain(first.id);
    }
  });

  it("stops at the first cell behind inter-cell thermal barriers", () => {
    const world = moduleRun(0.05);
    const states = node(world, "module").battery!.cellStates;
    expect(states[0] === "runaway" || states[0] === "burned-out").toBe(true);
    expect(states.slice(1).every((s) => s !== "runaway" && s !== "burned-out")).toBe(true);
  });

  it("lets NMC vent gas burn at the vent while cooler LFP vent gas goes unignited into the room", () => {
    const results = (["nmc", "lfp"] as const).map((chemistry) => {
      const world = new SimulationWorld();
      part(world, "module", boxGeometry(vec3(1, 0.6, 0.4), 0.002), vec3(0, 0.3, 0));
      world.setCascadePlant(
        plant([{ componentId: "module", battery: nmcModule(1, 0, chemistry) }], {
          faults: [
            { kind: "cell-internal-short", componentId: "module", atTimeSec: 1, cellIndex: 0 },
          ],
          enclosures: [
            { id: "room", minM: vec3(-3, 0, -3), maxM: vec3(3, 3, 3), airChangesPerHour: 0 },
          ],
        }),
      );
      world.stepMany(seconds(300));
      return { kinds: kinds(world), gas: world.cascade!.enclosureGas("room")!["battery-vent-gas"] };
    });
    const [nmc, lfp] = results;
    // NMC runs away to ~780 °C, past the vent gas's ~500 °C auto-ignition: a jet fire.
    // (Its earliest, cooler vent gas still escapes unburned, as in real tests.)
    expect(nmc!.kinds).toContain("ignition");
    // LFP peaks near ~420 °C: the gas never ignites by itself and collects in the room.
    expect(lfp!.kinds).toContain("thermal-runaway");
    expect(lfp!.kinds).not.toContain("ignition");
    expect(lfp!.gas).toBeGreaterThan(0.1);
  });
});

describe("cascade: gas accumulation", () => {
  function room(withIgniter: boolean, ventReliefPa?: number) {
    const world = new SimulationWorld();
    part(world, "module", boxGeometry(vec3(1, 1.2, 0.6), 0.002), vec3(0, 0.6, 0));
    const nodes: CascadeNodeSpec[] = [{ componentId: "module", battery: nmcModule(20, 0, "lfp") }];
    if (withIgniter) {
      part(world, "hot-plate", boxGeometry(vec3(0.3, 0.3, 0.3)), vec3(1.2, 0.5, 0.8));
      nodes.push({ componentId: "hot-plate", initialTemperatureK: 1200 });
    }
    const faults: InducedFaultSpec[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "cell-internal-short" as const,
      componentId: "module",
      atTimeSec: 1,
      cellIndex: i,
    }));
    world.setCascadePlant(
      plant(nodes, {
        faults,
        enclosures: [
          {
            id: "room",
            minM: vec3(-1, 0, -1),
            maxM: vec3(1.5, 3, 1.5),
            airChangesPerHour: 0,
            ...(ventReliefPa === undefined ? {} : { ventReliefPressurePa: ventReliefPa }),
          },
        ],
      }),
    );
    return world;
  }

  it("accumulates flammable vent gas without igniting it when nothing can ignite it", () => {
    const world = room(false);
    world.stepMany(seconds(240));
    expect(kinds(world)).toContain("gas-flammable");
    expect(kinds(world)).not.toContain("deflagration");
    expect(world.cascade!.enclosureFlammableFraction("room")).toBeGreaterThan(0.075);
  });

  it("burns as a deflagration once an ignition source is present, with ΔP = (γ−1)·E/V", () => {
    const world = room(true);
    let before = 0;
    for (let i = 0; i < seconds(240); i += 1) {
      before = world.cascade!.enclosureGas("room")!["battery-vent-gas"];
      world.step();
      if (kinds(world).includes("deflagration")) break;
    }
    const events = world.getSnapshot().cascade!.events;
    const deflagration = events.find((e) => e.kind === "deflagration")!;
    expect(deflagration).toBeDefined();
    const flammable = events.find((e) => e.kind === "gas-flammable")!;
    expect(deflagration.parentIds).toContain(flammable.id);
    const volume = 2.5 * 3 * 2.5;
    // Energy of the gas that burned (vent gas plus a little pyrolysate-free margin).
    expect(deflagration.energyReleasedJ).toBeGreaterThanOrEqual(
      before * megajoulesToJoules(12) * 0.99,
    );
    const failure = world.getSnapshot().failures.find((f) => f.failureType === "deflagration")!;
    expect(failure.measuredValue).toBeCloseTo((0.4 * deflagration.energyReleasedJ) / volume, 3);
    expect(world.cascade!.enclosureGas("room")!["battery-vent-gas"]).toBe(0);
  });

  it("is limited by deflagration vent panels", () => {
    const world = room(true, 5000);
    world.stepMany(seconds(240));
    const failure = world.getSnapshot().failures.find((f) => f.failureType === "deflagration")!;
    expect(failure.measuredValue).toBe(5000);
  });
});

describe("cascade: pipes, pressure and relief", () => {
  function pipeScene(options: { blockedIn: boolean; relief?: number; flowing: boolean }) {
    const world = new SimulationWorld();
    part(world, "pipe", cylinderGeometry(0.0445, 2, "x", 0.0055), vec3(0, 2, 0));
    part(world, "pump", boxGeometry(vec3(0.5, 0.5, 0.5), 0.01), vec3(3, 0.25, 0));
    world.setCascadePlant(
      plant(
        [
          {
            componentId: "pipe",
            initialTemperatureK: celsiusToKelvin(150),
            pipe: {
              loopId: "loop",
              waterMassKg: 8.8,
              flowCoolingWPerK: 1500,
              breachAreaM2: 0.003,
              blockedIn: options.blockedIn,
              ...(options.relief === undefined ? {} : { reliefSetPressurePa: options.relief }),
            },
          },
          {
            componentId: "pump",
            pump: { loopId: "loop", ratedFlowKgPerSec: 10, coastdownTimeConstantSec: 5 },
          },
        ],
        {
          faults: [
            {
              kind: "external-heat",
              componentId: "pipe",
              atTimeSec: 0,
              powerW: 40_000,
              durationSec: 3600,
            },
            ...(options.flowing
              ? []
              : [{ kind: "loss-of-power" as const, componentId: "pump", atTimeSec: 0 }]),
          ],
          coolantLoops: [
            {
              id: "loop",
              inventoryKg: 2000,
              supplyTemperatureK: celsiusToKelvin(150),
              operatingPressurePa: megapascalsToPascals(1.5),
              minimumInventoryFraction: 0.3,
            },
          ],
        },
      ),
    );
    return world;
  }

  it("stays near the supply temperature while coolant flows", () => {
    const world = pipeScene({ blockedIn: true, flowing: true });
    world.stepMany(seconds(300));
    expect(node(world, "pipe").temperatureK).toBeLessThan(celsiusToKelvin(180));
    expect(kinds(world)).not.toContain("pipe-ruptured");
  });

  it("ruptures a heated blocked-in section once saturation pressure exceeds the hot wall", () => {
    const world = pipeScene({ blockedIn: true, flowing: false });
    world.stepMany(seconds(900));
    const rupture = world.getSnapshot().cascade!.events.find((e) => e.kind === "pipe-ruptured");
    expect(rupture).toBeDefined();
    expect(rupture!.description).toMatch(/hoop stress/);
    const fault = world
      .getSnapshot()
      .cascade!.events.find((e) => e.kind === "induced-fault" && e.componentId === "pipe")!;
    expect(world.cascade!.ancestorsOf(rupture!.id)).toContain(fault.id);
  });

  it("is held at the relief set point instead of rupturing when it has a relief valve", () => {
    const world = pipeScene({ blockedIn: true, relief: megapascalsToPascals(2), flowing: false });
    world.stepMany(seconds(900));
    expect(kinds(world)).toContain("relief-valve-opened");
    expect(kinds(world)).not.toContain("pipe-ruptured");
    expect(node(world, "pipe").pipe!.pressurePa).toBeLessThanOrEqual(megapascalsToPascals(2));
  });

  it("boils off into the loop at loop pressure when the line is open", () => {
    const world = pipeScene({ blockedIn: false, flowing: false });
    world.stepMany(seconds(120));
    expect(node(world, "pipe").pipe!.pressurePa).toBe(megapascalsToPascals(1.5));
  });
});

describe("cascade: electrical protection and network propagation", () => {
  function circuit(pickupA: number, delaySec: number) {
    const world = new SimulationWorld();
    const e = (id: string, x: number) =>
      part(world, id, boxGeometry(vec3(0.5, 0.5, 0.5), 0.003), vec3(x, 0.25, 0), {
        sockets: [
          ["a", vec3(-0.25, 0, 0), vec3(-1, 0, 0), "electrical"],
          ["b", vec3(0.25, 0, 0), vec3(1, 0, 0), "electrical"],
        ],
      });
    e("supply", 0);
    e("breaker", 2);
    e("cable", 4);
    e("pump", 6);
    const wire = (a: string, b: string) =>
      world.connect(
        { componentId: a, connectionPointId: "b" },
        { componentId: b, connectionPointId: "a" },
        { type: "electrical" },
      );
    wire("supply", "breaker");
    wire("breaker", "cable");
    wire("cable", "pump");
    world.setCascadePlant(
      plant(
        [
          {
            componentId: "supply",
            electrical: {
              role: "source",
              nominalVoltageV: 400,
              arcingFaultCurrentA: 2000,
              arcVoltageV: 150,
            },
          },
          {
            componentId: "breaker",
            electrical: { role: "breaker", pickupCurrentA: pickupA, tripDelaySec: delaySec },
          },
          {
            componentId: "cable",
            electrical: {
              role: "conductor",
              lengthM: 10,
              conductorAreaM2: 1.2e-4,
              conductorMaterialId: "copper",
              insulation: "xlpe",
              insulationMassKg: 4,
              conductorToShellConductanceWPerK: 3,
              burnClearLengthM: 0.5,
            },
          },
          {
            componentId: "pump",
            electrical: { role: "load", powerW: 40_000 },
            pump: { loopId: "loop", ratedFlowKgPerSec: 10, coastdownTimeConstantSec: 8 },
          },
        ],
        {
          faults: [{ kind: "insulation-breakdown", componentId: "cable", atTimeSec: 1 }],
          coolantLoops: [
            {
              id: "loop",
              inventoryKg: 1000,
              supplyTemperatureK: 300,
              operatingPressurePa: 2e5,
              minimumInventoryFraction: 0.3,
            },
          ],
        },
      ),
    );
    return world;
  }

  it("trips a correctly set breaker, and the load downstream loses power and coasts down", () => {
    const world = circuit(1000, 0.1);
    world.stepMany(seconds(1));
    world.stepMany(seconds(0.2));
    const events = world.getSnapshot().cascade!.events;
    const arc = events.find((e) => e.kind === "arc-fault")!;
    const trip = events.find((e) => e.kind === "breaker-tripped")!;
    expect(trip.parentIds).toEqual([arc.id]);
    expect(trip.timeSec - arc.timeSec).toBeCloseTo(0.1, 1);
    const lost = events.find((e) => e.kind === "power-lost" && e.componentId === "pump")!;
    expect(world.cascade!.ancestorsOf(lost.id)).toContain(trip.id);

    const tripTime = world.simulatedTimeSec;
    world.stepMany(seconds(8));
    const flow = node(world, "pump").pump!.flowFraction;
    // Exponential coast-down: after one time constant, e^-1 of rated flow remains.
    expect(flow).toBeCloseTo(Math.exp(-(world.simulatedTimeSec - tripTime) / 8), 1);
  });

  it("lets an arc burn when the breaker cannot see it, until it burns the circuit open", () => {
    const world = circuit(5000, 0.5);
    world.stepMany(seconds(60));
    const events = world.getSnapshot().cascade!.events;
    expect(events.some((e) => e.kind === "breaker-tripped")).toBe(false);
    const cleared = events.find((e) => e.kind === "arc-extinguished")!;
    expect(cleared.description).toMatch(/burned the circuit open/);
    const arc = events.find((e) => e.kind === "arc-fault")!;
    expect(arc.energyReleasedJ).toBeGreaterThan(0);
    expect(events.find((e) => e.kind === "power-lost")!.parentIds).toEqual([cleared.id]);
  });
});

describe("cascade: magnet quench and plasma", () => {
  function magnetPlant(options: { dumpOhm: number; controlled: boolean; loseCooling?: boolean }) {
    const world = new SimulationWorld();
    part(world, "magnet", cylinderGeometry(1, 2, "y", 0.03), vec3(0, 1, 0), {
      materialId: MaterialIds.StainlessSteel,
    });
    part(world, "cryoplant", boxGeometry(vec3(1, 1, 1), 0.005), vec3(4, 0.5, 0));
    part(world, "pump", boxGeometry(vec3(0.5, 0.5, 0.5), 0.005), vec3(4, 0.25, 3));
    part(world, "reactor", cylinderGeometry(1.5, 3, "y", 0.05), vec3(0, 1.5, 5), {
      materialId: MaterialIds.StainlessSteel,
    });
    world.setCascadePlant(
      plant(
        [
          {
            componentId: "cryoplant",
            cryoplant: { cryostatComponentId: "magnet", refrigerationW: 600 },
          },
          {
            componentId: "magnet",
            cryostat: { heliumInventoryKg: 0.5, heatLeakConductanceWPerK: 2, coldMassKg: 2000 },
            magnet: {
              cryostatComponentId: "magnet",
              storedEnergyJ: megajoulesToJoules(200),
              operatingCurrentA: 40_000,
              currentSharingTemperatureK: 6.5,
              dumpResistanceOhm: options.dumpOhm,
              quenchDetectionDelaySec: 0.5,
              unprotectedDecayTimeSec: 5,
            },
          },
          {
            componentId: "pump",
            pump: { loopId: "loop", ratedFlowKgPerSec: 30, coastdownTimeConstantSec: 2 },
          },
          {
            componentId: "reactor",
            initialTemperatureK: celsiusToKelvin(250),
            cooledLoad: { loopId: "loop", heatGenerationW: 0, coolingWPerK: 20_000 },
            plasma: {
              magnetComponentId: "magnet",
              storedThermalEnergyJ: megajoulesToJoules(50),
              wallHeatingW: 2_000_000,
              minimumFieldFraction: 0.8,
              disruptionWettedAreaFraction: 0.05,
              thermalQuenchDurationSec: 0.002,
              ...(options.controlled
                ? { controlledShutdown: { onCoolantFlowFractionBelow: 0.5, rampDownSec: 10 } }
                : {}),
            },
          },
        ],
        {
          faults: options.loseCooling
            ? [{ kind: "loss-of-power", componentId: "pump", atTimeSec: 1 }]
            : [{ kind: "loss-of-power", componentId: "cryoplant", atTimeSec: 1 }],
          coolantLoops: [
            {
              id: "loop",
              inventoryKg: 5000,
              supplyTemperatureK: celsiusToKelvin(150),
              operatingPressurePa: 1.5e6,
              minimumInventoryFraction: 0.3,
            },
          ],
        },
      ),
    );
    world.stepMany(seconds(120));
    return world;
  }

  it("quenches after the helium boils off, collapses the field and disrupts the plasma", () => {
    const world = magnetPlant({ dumpOhm: 0, controlled: false });
    const events = world.getSnapshot().cascade!.events;
    const order = [
      "refrigeration-lost",
      "helium-dry-out",
      "magnet-quench",
      "plasma-disruption",
    ] as const;
    const times = order.map((k) => events.find((e) => e.kind === k)!.timeSec);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const quench = events.find((e) => e.kind === "magnet-quench")!;
    const disruption = events.find((e) => e.kind === "plasma-disruption")!;
    expect(world.cascade!.ancestorsOf(disruption.id)).toContain(quench.id);
    expect(quench.energyReleasedJ).toBeCloseTo(megajoulesToJoules(200), -5);
    // Without a dump, the coil absorbs everything — but integrated through cryogenic
    // enthalpy it warms by hundreds of kelvin, not to copper's melting point.
    expect(events.some((e) => e.kind === "melted-through" && e.componentId === "magnet")).toBe(
      false,
    );
    expect(node(world, "magnet").cryostat!.coldMassTemperatureK).toBeGreaterThan(100);
  });

  it("sends most of the stored energy to the dump resistor when quench protection is fitted", () => {
    const world = magnetPlant({ dumpOhm: 0.25, controlled: false });
    const events = world.getSnapshot().cascade!.events;
    const quench = events.find((e) => e.kind === "magnet-quench")!;
    const dump = events.find((e) => e.kind === "quench-dump")!;
    expect(dump.energyReleasedJ).toBeGreaterThan(quench.energyReleasedJ * 3);
    // The coil still absorbs what decays during the 0.5 s detection delay (~18%).
    const unprotected = magnetPlant({ dumpOhm: 0, controlled: false });
    expect(node(world, "magnet").cryostat!.coldMassTemperatureK).toBeLessThan(
      node(unprotected, "magnet").cryostat!.coldMassTemperatureK / 2,
    );
  });

  it("ramps the plasma down in a controlled way when cooling is lost and control is fitted", () => {
    const controlled = magnetPlant({ dumpOhm: 0.25, controlled: true, loseCooling: true });
    expect(kinds(controlled)).toContain("plasma-controlled-shutdown");
    expect(kinds(controlled)).not.toContain("plasma-disruption");
    expect(node(controlled, "reactor").plasma!.state).toBe("off");
  });
});

describe("cascade: hot structure, displaced equipment and flanges", () => {
  it("weakens a heated support until it yields, drops what it carries and opens the flange", () => {
    const world = new SimulationWorld({ settings: { failurePropagation: "detach" } });
    part(world, "support", boxGeometry(vec3(0.06, 2.5, 0.06), 0.004), vec3(0, 1.25, 0), {
      anchored: false,
      sockets: [["top", vec3(0, 1.25, 0), vec3(0, 1, 0), "structural"]],
    });
    part(world, "vessel", boxGeometry(vec3(1, 1.4, 1), 0.02), vec3(0, 3.2, 0), {
      anchored: false,
      additionalMassKg: 14_000,
      sockets: [
        ["base", vec3(0, -0.7, 0), vec3(0, -1, 0), "structural"],
        ["nozzle", vec3(-0.5, 0, 0), vec3(-1, 0, 0), "coolant"],
      ],
    });
    part(world, "pipe", cylinderGeometry(0.0445, 2, "x", 0.0055), vec3(-1.5, 3.2, 0), {
      sockets: [["end", vec3(1, 0, 0), vec3(1, 0, 0), "coolant"]],
    });
    world.connect(
      { componentId: "vessel", connectionPointId: "base" },
      { componentId: "support", connectionPointId: "top" },
    );
    world.connect(
      { componentId: "pipe", connectionPointId: "end" },
      { componentId: "vessel", connectionPointId: "nozzle" },
      { type: "coolant" },
    );
    world.setCascadePlant(
      plant(
        [
          { componentId: "support" },
          { componentId: "vessel" },
          {
            componentId: "pipe",
            pipe: {
              loopId: "loop",
              waterMassKg: 5,
              flowCoolingWPerK: 0,
              breachAreaM2: 0.005,
              flangeSeparationLimitM: 0.05,
            },
          },
        ],
        {
          faults: [
            {
              kind: "external-heat",
              componentId: "support",
              atTimeSec: 0,
              powerW: 25_000,
              durationSec: 3600,
            },
          ],
          coolantLoops: [
            {
              id: "loop",
              inventoryKg: 3000,
              supplyTemperatureK: 420,
              operatingPressurePa: 1.5e6,
              minimumInventoryFraction: 0.3,
            },
          ],
          enclosures: [
            { id: "hall", minM: vec3(-5, 0, -5), maxM: vec3(5, 6, 5), airChangesPerHour: 2 },
          ],
        },
      ),
    );
    world.stepMany(seconds(600));

    const events = world.getSnapshot().cascade!.events;
    const yielded = events.find((e) => e.kind === "support-yielded")!;
    expect(yielded).toBeDefined();
    expect(yielded.componentId).toBe("support");
    const flange = events.find((e) => e.kind === "flange-separated")!;
    expect(flange.parentIds).toEqual([yielded.id]);
    expect(events.some((e) => e.kind === "coolant-inventory-low")).toBe(true);
    // The structural failure log says the member was hot, not merely overloaded.
    const structural = world
      .getSnapshot()
      .failures.find((f) => f.componentId === "support" && f.system === "structural")!;
    expect(structural.cause).toMatch(/Heated to/);
    // The blowdown flashes to steam because the water is above 100 °C.
    expect(world.cascade!.enclosureGas("hall")!.steam).toBeGreaterThan(0);
  });
});

describe("cascade: determinism", () => {
  it("produces bit-identical event logs and temperatures from identical inputs", () => {
    const run = () => {
      const world = new SimulationWorld();
      part(world, "oil-pan", boxGeometry(vec3(1.5, 0.3, 1.5), 0.005), vec3(0, 0.15, 0));
      part(world, "module", boxGeometry(vec3(1, 0.6, 0.4), 0.002), vec3(1.2, 0.3, 0));
      world.setCascadePlant(
        plant(
          [
            {
              componentId: "oil-pan",
              combustible: { kind: "transformer-oil", massKg: 40, burningAreaM2: 2 },
            },
            { componentId: "module", battery: nmcModule(4, 2) },
          ],
          {
            faults: [
              {
                kind: "external-heat",
                componentId: "oil-pan",
                atTimeSec: 0,
                powerW: 300_000,
                durationSec: 240,
              },
              { kind: "pilot-flame", componentId: "oil-pan", atTimeSec: 0, durationSec: 240 },
            ],
          },
        ),
      );
      world.stepMany(seconds(400));
      const snapshot = world.getSnapshot().cascade!;
      return JSON.stringify({ events: snapshot.events, nodes: snapshot.nodes });
    };
    expect(run()).toBe(run());
  });
});
