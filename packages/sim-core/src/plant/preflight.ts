import { getMaterial } from "@forgelab/materials";
import type { SimulationComponent } from "../component.js";
import type { Connection } from "../connections.js";
import { getCoolantFluid, lameHoopStressPa, loopPressurePa } from "./fluids.js";
import { booleanParameter, COOLED_ROLES, numberParameter, stringParameter } from "./roles.js";
import { geometricCouplings } from "./fieldCoupling.js";
import { buildTopology, groupsOver, type PlantTopology } from "./topology.js";

/**
 * Preflight: engineering checks before ACTIVATE. They explain problems the simulation is
 * likely to run into; they never block a run of a well-formed design and never prescribe
 * a part ("replace pump A with pump B") — the player chooses the fix. Every check reads
 * the same topology, groupings and models the plant solver uses, so preflight and the
 * run agree about what is connected to what.
 */
export type PreflightSystem =
  | "electrical"
  | "cooling"
  | "cryogenics"
  | "vacuum"
  | "fuel"
  | "heating"
  | "magnets"
  | "structure"
  | "design";

export type PreflightCode =
  | "EMPTY_DESIGN"
  | "UNCONNECTED_PORT"
  | "NO_POWER_SOURCE"
  | "NO_STARTUP_POWER"
  | "OPEN_COOLANT_LOOP"
  | "UNPUMPED_COOLANT_LOOP"
  | "PIPE_PRESSURE_LIMIT"
  | "NO_VACUUM_PUMP"
  | "NO_FUEL"
  | "NO_HEATING"
  | "NO_CONFINING_FIELD"
  | "COIL_SERVES_NO_PLASMA"
  | "NO_SUPERCONDUCTOR_COOLING";

export interface PreflightItem {
  readonly code: PreflightCode;
  readonly system: PreflightSystem;
  /** `blocking` only when the design cannot be simulated at all. */
  readonly severity: "warning" | "blocking";
  readonly componentIds: readonly string[];
  readonly message: string;
}

export interface PreflightReport {
  readonly items: readonly PreflightItem[];
  /** False only when the design cannot be simulated (nothing else stops ACTIVATE). */
  readonly canActivate: boolean;
}

/** Port domains whose absence leaves a machine unable to do its job. */
const SERVICE_DOMAINS = new Set(["electrical", "fluid", "vacuum", "fuel", "shaft"]);

const ELECTRICAL_ROLES = new Set([
  "plasma-heater",
  "fuel-injector",
  "vacuum-pump",
  "coolant-pump",
  "magnet-coil",
  "power-supply",
  "generator",
  "conductor",
  "switch",
]);
const LOAD_ROLES = new Set(["plasma-heater", "fuel-injector", "vacuum-pump", "coolant-pump"]);

const label = (c: SimulationComponent) => (c.label.trim() !== "" ? c.label : c.id);
const list = (names: readonly string[]) =>
  names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

export function preflight(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
): PreflightReport {
  if (components.length === 0)
    return {
      items: [
        {
          code: "EMPTY_DESIGN",
          system: "design",
          severity: "blocking",
          componentIds: [],
          message: "There is nothing to simulate yet.",
        },
      ],
      canActivate: false,
    };
  const topology = buildTopology(components, connections);
  const items: PreflightItem[] = [
    ...unconnectedPorts(components, connections),
    ...electrical(topology, components),
    ...coolant(topology, components),
    ...plasmaSystems(topology, components),
  ];
  return { items, canActivate: true };
}

function unconnectedPorts(
  components: readonly SimulationComponent[],
  connections: readonly Connection[],
): PreflightItem[] {
  const used = new Set<string>();
  for (const c of connections) {
    used.add(`${c.from.componentId}/${c.from.connectionPointId}`);
    used.add(`${c.to.componentId}/${c.to.connectionPointId}`);
  }
  const out: PreflightItem[] = [];
  for (const component of components) {
    // A superconducting coil is cooled cryogenically, not by the water loop: the solver
    // ignores its case-cooling ports, so leaving them open has no consequence to report.
    const cryoCooled =
      component.role === "magnet-coil" && booleanParameter(component.parameters, "superconducting");
    const open = component.connectionPoints.filter(
      (p) =>
        p.port !== undefined &&
        SERVICE_DOMAINS.has(p.port.domain) &&
        !(cryoCooled && p.port.domain === "fluid") &&
        !used.has(`${component.id}/${p.id}`),
    );
    if (open.length === 0) continue;
    out.push({
      code: "UNCONNECTED_PORT",
      system: systemOfDomain(open[0]!.port!.domain),
      severity: "warning",
      componentIds: [component.id],
      message: `${label(component)} has ${open.length === 1 ? "an unconnected port" : "unconnected ports"}: ${list(open.map((p) => p.port!.label))}.`,
    });
  }
  return out;
}

function systemOfDomain(domain: string): PreflightSystem {
  switch (domain) {
    case "electrical":
      return "electrical";
    case "fluid":
      return "cooling";
    case "vacuum":
      return "vacuum";
    case "fuel":
      return "fuel";
    default:
      return "design";
  }
}

function electrical(
  topology: PlantTopology,
  components: readonly SimulationComponent[],
): PreflightItem[] {
  const members = components.filter((c) => ELECTRICAL_ROLES.has(c.role));
  const isOpen = (id: string) => {
    const c = topology.byId.get(id);
    return c?.role === "switch" && !booleanParameter(c.parameters, "closed");
  };
  const { groups } = groupsOver(
    topology,
    members.map((c) => c.id),
    ["electrical"],
    (link) => !isOpen(link.a) && !isOpen(link.b),
  );
  const out: PreflightItem[] = [];
  for (const group of groups) {
    const parts = group.map((id) => topology.byId.get(id)!);
    const loads = parts.filter(
      (c) =>
        LOAD_ROLES.has(c.role) ||
        (c.role === "magnet-coil" && numberParameter(c.parameters, "currentA") > 0),
    );
    if (loads.length === 0) continue;
    const grid = parts.some((c) => c.role === "power-supply");
    const generator = parts.some((c) => c.role === "generator");
    if (!grid && !generator)
      out.push({
        code: "NO_POWER_SOURCE",
        system: "electrical",
        severity: "warning",
        componentIds: loads.map((c) => c.id),
        message: `${list(loads.map(label))} ${loads.length === 1 ? "has" : "have"} no electrical path to a power source.`,
      });
    else if (!grid)
      out.push({
        code: "NO_STARTUP_POWER",
        system: "electrical",
        severity: "warning",
        componentIds: loads.map((c) => c.id),
        message: `Only a generator feeds ${list(loads.map(label))}: nothing powers them before the plant itself generates.`,
      });
  }
  return out;
}

function coolant(
  topology: PlantTopology,
  components: readonly SimulationComponent[],
): PreflightItem[] {
  // The solver's own loop membership: pipes, pumps and cooled parts joined by coolant
  // links (superconducting coils are cooled cryogenically, not by the loop).
  const loopRoles = new Set<string>(["coolant-pipe", "coolant-pump", ...COOLED_ROLES]);
  const connected = new Set<string>();
  for (const link of topology.links.get("coolant") ?? []) {
    connected.add(link.a);
    connected.add(link.b);
  }
  const members = components
    .filter(
      (c) =>
        loopRoles.has(c.role) &&
        connected.has(c.id) &&
        !(c.role === "magnet-coil" && booleanParameter(c.parameters, "superconducting")),
    )
    .map((c) => c.id);
  const { groups, linksByGroup } = groupsOver(topology, members, ["coolant"]);
  const out: PreflightItem[] = [];
  groups.forEach((group, i) => {
    const links = linksByGroup[i]!;
    const parts = group.map((id) => topology.byId.get(id)!);
    const pumps = parts.filter((c) => c.role === "coolant-pump");
    // Same closure rule as the solver: a loop needs at least as many links as members.
    if (links.length < group.length || group.length < 2) {
      const degree = new Map<string, number>(group.map((id) => [id, 0]));
      for (const link of links) {
        degree.set(link.a, (degree.get(link.a) ?? 0) + 1);
        degree.set(link.b, (degree.get(link.b) ?? 0) + 1);
      }
      const ends = group.filter((id) => (degree.get(id) ?? 0) < 2);
      out.push({
        code: "OPEN_COOLANT_LOOP",
        system: "cooling",
        severity: "warning",
        componentIds: ends,
        message: `A coolant loop is open at ${list(ends.map((id) => label(topology.byId.get(id)!)))}: coolant has no return path, so nothing will circulate.`,
      });
    }
    if (pumps.length === 0)
      out.push({
        code: "UNPUMPED_COOLANT_LOOP",
        system: "cooling",
        severity: "warning",
        componentIds: group,
        message: `No pump drives the coolant loop through ${list(parts.map(label))}.`,
      });
    // Pressure boundary at the loop's operating pressure (cold start; pump head adds more).
    const fluid = getCoolantFluid(
      pumps.length > 0 ? stringParameter(pumps[0]!.parameters, "fluid") : "pressurized-water",
    );
    const pressurePa = loopPressurePa(fluid, 293.15);
    for (const pipe of parts) {
      if (pipe.role !== "coolant-pipe" || pipe.geometry.kind !== "cylinder") continue;
      const outerM = pipe.geometry.radiusM;
      const innerM = Math.max(0, outerM - (pipe.geometry.wallThicknessM ?? outerM));
      const hoopPa = lameHoopStressPa(pressurePa, innerM, outerM);
      const yieldPa = getMaterial(pipe.materialId).yieldStrengthPa;
      if (hoopPa >= yieldPa)
        out.push({
          code: "PIPE_PRESSURE_LIMIT",
          system: "cooling",
          severity: "warning",
          componentIds: [pipe.id],
          message: `${label(pipe)}: its wall would carry ${(hoopPa / 1e6).toFixed(0)} MPa of hoop stress at the loop's ${(pressurePa / 1e6).toFixed(1)} MPa, above its ${(yieldPa / 1e6).toFixed(0)} MPa yield strength.`,
        });
    }
  });
  return out;
}

function plasmaSystems(
  topology: PlantTopology,
  components: readonly SimulationComponent[],
): PreflightItem[] {
  const out: PreflightItem[] = [];
  // Coils the analytic models do not cover still serve a plasma through their geometric
  // field (fieldCoupling.ts), exactly as the solver will see it.
  const geometric = geometricCouplings(topology);
  for (const vessel of topology.vessels) {
    const name = label(topology.byId.get(vessel.vesselId)!);
    if (vessel.pumpIds.length === 0)
      out.push({
        code: "NO_VACUUM_PUMP",
        system: "vacuum",
        severity: "warning",
        componentIds: [vessel.vesselId],
        message: `${name} has no vacuum pump connected: it stays at atmospheric pressure, and plasma breakdown needs vacuum.`,
      });
    if (vessel.injectorIds.length === 0)
      out.push({
        code: "NO_FUEL",
        system: "fuel",
        severity: "warning",
        componentIds: [vessel.vesselId],
        message: `${name} has no fuel supply connected.`,
      });
    if (vessel.heaterIds.length === 0)
      out.push({
        code: "NO_HEATING",
        system: "heating",
        severity: "warning",
        componentIds: [vessel.vesselId],
        message: `${name} has no plasma heating connected.`,
      });
    const served = [...geometric.values()].some((g) => g.vesselId === vessel.vesselId);
    if (vessel.coilIds.length === 0 && !served)
      out.push({
        code: "NO_CONFINING_FIELD",
        system: "magnets",
        severity: "warning",
        componentIds: [vessel.vesselId],
        message: `No coil puts a significant magnetic field on the plasma in ${name}.`,
      });
  }
  const idle = topology.orphanCoilIds.filter((id) => !geometric.has(id));
  if (topology.vessels.length > 0 && idle.length > 0)
    out.push({
      code: "COIL_SERVES_NO_PLASMA",
      system: "magnets",
      severity: "warning",
      componentIds: idle,
      message: `${list(idle.map((id) => label(topology.byId.get(id)!)))}: ${idle.length === 1 ? "its" : "their"} field barely reaches any plasma where ${idle.length === 1 ? "it is" : "they are"} placed.`,
    });
  for (const coil of components) {
    if (
      coil.role === "magnet-coil" &&
      booleanParameter(coil.parameters, "superconducting") &&
      numberParameter(coil.parameters, "cryoCapacityW") <= 0
    )
      out.push({
        code: "NO_SUPERCONDUCTOR_COOLING",
        system: "cryogenics",
        severity: "warning",
        componentIds: [coil.id],
        message: `${label(coil)} is superconducting but has no refrigeration: any heat leak warms it towards a quench.`,
      });
  }
  return out;
}
