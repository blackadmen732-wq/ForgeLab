import type { SimulationComponent } from "../component.js";
import { isWithinBoschHaleRange } from "./fusion.js";
import { ipb98OutOfEnvelope } from "./plasma.js";
import { DT_ION_MASS_AMU, UNDERVOLTAGE_FRACTION } from "./constants.js";
import type {
  ConfidenceLevel,
  CoolantLoopSummary,
  ElectricalIslandSummary,
  ModelConfidence,
  PlantMetrics,
  SubsystemConfidence,
  VesselState,
} from "./state.js";
import type { PlantTopology } from "./topology.js";
import { combinedRipple, isPoloidalCoil, type GeometricCoupling } from "./fieldCoupling.js";
import { numberParameter } from "./roles.js";
import { getCoolantFluid } from "./fluids.js";

/**
 * Physics model confidence.
 *
 *  supported    — a standard configuration, with every reduced model used inside the
 *                 envelope it is documented for. It does NOT mean validated against a
 *                 real machine: every ForgeLab result comes from a reduced model.
 *  approximate  — a standard configuration, but at least one model is extrapolated
 *                 beyond its envelope or is only an order-of-magnitude estimate.
 *  experimental — a configuration ForgeLab's models were not built for. Results are
 *                 illustrative only and never represent a validated real-world design.
 *  unsupported  — ForgeLab cannot calculate this at all (e.g. a plasma in a branched
 *                 chamber). It says so rather than invent a number; the quantity is
 *                 reported as absent, not as zero-by-physics.
 *
 * The overall level is the worst subsystem level. Experimental and unsupported designs are
 * not eligible for verified leaderboards.
 */
/** Above this peak-to-mean field ripple along the plasma axis, confinement is experimental. */
export const RIPPLE_EXPERIMENTAL = 0.05;

const ORDER: Record<ConfidenceLevel, number> = {
  supported: 0,
  approximate: 1,
  experimental: 2,
  unsupported: 3,
};

export function worstLevel(levels: readonly ConfidenceLevel[]): ConfidenceLevel {
  let worst: ConfidenceLevel = "supported";
  for (const level of levels) if (ORDER[level] > ORDER[worst]) worst = level;
  return worst;
}

export function assessConfidence(input: {
  topology: PlantTopology;
  components: readonly SimulationComponent[];
  work: {
    vessels: ReadonlyMap<string, VesselState>;
    islands: readonly ElectricalIslandSummary[];
    loops: readonly CoolantLoopSummary[];
    diagnostics: readonly string[];
    vesselField: ReadonlyMap<string, number>;
  };
  metrics: PlantMetrics;
  /** Coils whose field reaches a plasma only through Biot–Savart (fieldCoupling.ts). */
  geometric?: ReadonlyMap<string, GeometricCoupling>;
  /** Parts exchanging heat through space this step, and parts on fire (hazards.ts). */
  hazards?: { readonly exchanging: number; readonly burning: readonly string[] };
}): ModelConfidence {
  const { topology, components, work } = input;
  const subsystems: SubsystemConfidence[] = [];
  const add = (subsystem: string, level: ConfidenceLevel, reasons: string[]) =>
    subsystems.push(Object.freeze({ subsystem, level, reasons: Object.freeze(reasons) }));

  // Structure.
  {
    const reasons: string[] = [];
    let level: ConfidenceLevel = "supported";
    for (const component of components) {
      if (
        component.state.structural.memberRole === "beam" &&
        component.state.support.supportedByComponentIds.length > 2
      ) {
        level = "approximate";
        reasons.push(
          `Beam "${component.id}" rests on more than two supports; intermediate supports are ignored (conservative).`,
        );
        break;
      }
    }
    add("structure", level, reasons);
  }

  // Electrical.
  if (work.islands.length > 0) {
    const sagging = work.islands.filter(
      (island) =>
        island.nominalVoltageV > 0 &&
        island.minVoltageV < UNDERVOLTAGE_FRACTION * island.nominalVoltageV,
    );
    add(
      "electrical",
      sagging.length > 0 ? "approximate" : "supported",
      sagging.map(
        (i) =>
          `Island ${i.id} sags below 90 % of nominal voltage; the constant-current load linearisation loses accuracy.`,
      ),
    );
  }

  // Coolant and thermal.
  if (work.loops.length > 0) {
    const reasons: string[] = [];
    let level: ConfidenceLevel = "supported";
    if (work.diagnostics.some((d) => d.includes("mixes coolants"))) {
      level = "experimental";
      reasons.push("A coolant loop mixes fluids, which V0.1 cannot represent.");
    }
    for (const loop of work.loops) {
      if (loop.temperatureK > getCoolantFluid(loop.fluidId).maxTemperatureK) {
        level = worstLevel([level, "approximate"]);
        reasons.push(
          `Loop ${loop.id} is above its fluid's temperature limit; fixed fluid properties no longer apply.`,
        );
      }
    }
    add("coolant", level, reasons);
  }

  // Magnetics.
  const coils = components.filter((c) => c.role === "magnet-coil");
  if (coils.length > 0) {
    const reasons: string[] = [];
    let level: ConfidenceLevel = "supported";
    const geometric = input.geometric ?? new Map<string, GeometricCoupling>();
    const idle = topology.orphanCoilIds.filter((id) => !geometric.has(id));
    // Rings and solenoids coaxial with a toroidal vessel are poloidal-field coils and
    // central solenoids: their field crosses the plasma's toroidal axis.
    const poloidal = idle.filter((id) => isPoloidalCoil(topology, id));
    const stray = idle.length - poloidal.length;
    if (poloidal.length > 0) {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        `${poloidal.length} coil(s) are coaxial with a toroidal vessel (poloidal-field coils or a central solenoid): in a real machine they shape, hold and drive the plasma; ForgeLab's 0D plasma model does not compute equilibrium or flux swing, so their field is computed but not used.`,
      );
    }
    if (stray > 0) {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        `${stray} coil(s) put no significant field on any plasma: computed from their geometry, it is negligible on every vessel's axis.`,
      );
    }
    if (geometric.size > 0) {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        `${geometric.size} coil(s) drive a plasma through a field computed from their geometry (Biot–Savart, one filament per winding), averaged along the plasma's axis; the plasma model treats that average as uniform.`,
      );
      for (const layout of topology.vessels) {
        if (layout.coilIds.length > 0) continue; // an analytic toroidal set dominates
        const mine = [...geometric.values()].filter((g) => g.vesselId === layout.vesselId);
        if (mine.length === 0) continue;
        const r = combinedRipple(
          mine,
          mine.map((g) => numberParameter(topology.byId.get(g.coilId)!.parameters, "currentA")),
        );
        if (r > RIPPLE_EXPERIMENTAL) {
          level = "experimental";
          reasons.push(
            `The field on "${layout.vesselId}"'s axis ripples by ${(r * 100).toFixed(0)} % between coils; ripple losses are not modelled, so confinement there is illustrative only.`,
          );
        }
      }
    }
    if (topology.vessels.some((v) => v.configuration === "linear" && v.coilIds.length > 0)) {
      level = worstLevel([level, "approximate"]);
      reasons.push("Solenoid fields are evaluated on axis only.");
    }
    add("magnetics", level, reasons);
  }

  // Plasma, fusion and neutronics.
  for (const layout of topology.vessels) {
    const vessel = work.vessels.get(layout.vesselId);
    if (vessel === undefined) continue;
    const plasma = vessel.plasma;
    const reasons: string[] = [];
    let level: ConfidenceLevel = "supported";
    // An open vessel is only a plasma experiment once something tries to make plasma in it
    // (heating or fuelling attached, or a plasma already formed); an empty chamber is not.
    const attempted =
      layout.heaterIds.length > 0 || layout.injectorIds.length > 0 || plasma.phase !== "off";
    const chamber = layout.chamber;
    const n = chamber.memberIds.length;
    if (chamber.path === "branched" && attempted) {
      level = "unsupported";
      reasons.push(
        `Chamber "${layout.vesselId}" (${n} segments) branches: ForgeLab has no plasma model for a branched chamber. Its vacuum is computed; a plasma in it is not.`,
      );
    }
    if (chamber.path === "loop") {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        `Chamber "${layout.vesselId}" is assembled from ${n} segments into a closed ring: the plasma model treats it as a torus of major radius ${chamber.majorRadiusM.toFixed(2)} m (centreline length / 2π) filling the narrowest bore.`,
      );
      if (!chamber.regular) {
        level = worstLevel([level, "experimental"]);
        reasons.push(
          `Its centreline departs ${chamber.departureM.toFixed(2)} m from a flat circle; the toroidal model assumes a circular axis, so confinement there is illustrative only.`,
        );
      }
    }
    if (chamber.path === "chain" && !chamber.regular && attempted) {
      level = worstLevel([level, "experimental"]);
      reasons.push(
        `Chamber "${layout.vesselId}" bends (its centreline strays ${chamber.departureM.toFixed(2)} m from straight); the linear model assumes a straight column.`,
      );
    }
    if (layout.configuration === "linear" && attempted) {
      level = "experimental";
      reasons.push(
        "Linear (open) configuration: confinement uses pessimistic Bohm diffusion and end losses along the field are not modelled.",
      );
    }
    if (layout.configuration === "tokamak" && plasma.plasmaCurrentA > 0) {
      const out = ipb98OutOfEnvelope({
        plasmaCurrentMA: plasma.plasmaCurrentA * 1e-6,
        toroidalFieldT: plasma.fieldT,
        lossPowerMW: 1,
        densityE19: plasma.densityM3 * 1e-19,
        ionMassAmu: DT_ION_MASS_AMU,
        majorRadiusM: plasma.majorRadiusM,
        inverseAspectRatio: plasma.majorRadiusM > 0 ? plasma.minorRadiusM / plasma.majorRadiusM : 0,
        elongation: layout.vesselId
          ? Number(topology.byId.get(layout.vesselId)!.parameters["elongation"])
          : 1,
      });
      if (out.length > 0) {
        level = worstLevel([level, "approximate"]);
        reasons.push(`IPB98(y,2) extrapolated: ${out.join("; ")}.`);
      }
    }
    if (
      plasma.temperatureKeV > 0 &&
      !isWithinBoschHaleRange(plasma.temperatureKeV) &&
      plasma.fusionPowerW > 0
    ) {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        `Ion temperature ${plasma.temperatureKeV.toFixed(2)} keV is outside the Bosch–Hale fit range (0.2–100 keV).`,
      );
    }
    if (plasma.fusionPowerW > 0) {
      level = worstLevel([level, "approximate"]);
      reasons.push(
        "Neutron energy deposition uses simple exponential attenuation, not neutron transport.",
      );
    }
    add(`plasma:${layout.vesselId}`, level, reasons);
  }
  // Heat through space and fire.
  if (
    input.hazards !== undefined &&
    (input.hazards.exchanging > 0 || input.hazards.burning.length > 0)
  ) {
    const reasons = [
      "Radiant heat between parts uses equivalent spheres with far-field view factors and no shadowing.",
    ];
    if (input.hazards.burning.length > 0)
      reasons.push(
        `${input.hazards.burning.length} part(s) on fire: free-burning rate over the whole outer surface, ignition judged from the part's lumped temperature, flame radiation as a point source. Not a fire-safety assessment.`,
      );
    add("hazards", "approximate", reasons);
  }
  const moduleCount = topology.vessels.reduce((n, v) => n + v.moduleIds.length, 0);
  if (moduleCount > 0) {
    add("neutronics", "approximate", [
      `${moduleCount} blanket module(s): each catches the plasma's neutrons by its projected area from a ring source on the magnetic axis, absorbing over its mean chord. Modules do not shadow one another individually; no Monte Carlo transport.`,
    ]);
  }
  if (topology.orphanBlanketIds.length > 0) {
    add("neutronics", "experimental", [
      `${topology.orphanBlanketIds.length} blanket(s) neither enclose a vessel nor sit within reach of a tokamak plasma, so they receive no neutrons.`,
    ]);
  }

  return Object.freeze({
    level: worstLevel(subsystems.map((s) => s.level)),
    subsystems: Object.freeze(subsystems),
  });
}
