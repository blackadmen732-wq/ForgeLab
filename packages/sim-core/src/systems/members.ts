import type { Meters, Newtons, Pascals } from "@forgelab/shared";
import type { ComponentGeometry, GeometryAxis } from "../geometry.js";

/**
 * Member mechanics for Structural 0.1: section properties, beam bending and column
 * buckling. Every function here is a closed-form textbook relationship; the references
 * are given next to each one and collected in docs/ARCHITECTURE.md §6.
 *
 * All functions are pure, deterministic and work in SI.
 */

/** How the structural solver idealises a member for Structural 0.1. */
export type MemberRole =
  /** Long axis within 45 degrees of vertical: axial compression + buckling. */
  | "column"
  /** Long axis horizontal and held at discrete points: bending between supports. */
  | "beam"
  /** No dominant axis, or resting directly on the ground: axial compression only. */
  | "block";

export interface SectionProperties {
  /** Material area of the cross-section, m². */
  readonly areaM2: number;
  /** Second moment of area about the axis giving the smallest value, m⁴. */
  readonly minSecondMomentM4: number;
  /** Radius of gyration sqrt(I_min / A), m. */
  readonly minRadiusOfGyrationM: Meters;
}

/** Local extent of the geometry along one of its axes, m. */
export function extentAlongAxis(geometry: ComponentGeometry, axis: GeometryAxis): Meters {
  if (geometry.kind === "box") return geometry.sizeM[axis];
  if (geometry.kind === "torus") {
    return axis === geometry.axis
      ? 2 * geometry.minorRadiusM
      : 2 * (geometry.majorRadiusM + geometry.minorRadiusM);
  }
  return axis === geometry.axis ? geometry.heightM : 2 * geometry.radiusM;
}

const OTHER_AXES: Record<GeometryAxis, readonly [GeometryAxis, GeometryAxis]> = {
  x: ["y", "z"],
  y: ["x", "z"],
  z: ["x", "y"],
};

/**
 * Second moment of area of the section cut perpendicular to `memberAxis`, for bending that
 * varies across `depthAxis` (the neutral axis is the third axis).
 *
 * Box (solid):  I = b·d³/12
 * Box (shell):  I = (b·d³ − (b−2t)(d−2t)³)/12      (rectangular hollow section)
 * Cylinder, section along its own axis:  I = π(r⁴ − rᵢ⁴)/4   (circular / annular)
 * Cylinder cut across its axis: the rectangular mid-plane section 2r × h, treated as a
 *   rectangle. DOCUMENTED APPROXIMATION: exact at the mid-plane only.
 *
 * Reference: any strength-of-materials text, e.g. Gere & Goodno, Mechanics of Materials,
 * Appendix E (properties of plane areas).
 */
export function secondMomentOfAreaM4(
  geometry: ComponentGeometry,
  memberAxis: GeometryAxis,
  depthAxis: GeometryAxis,
): number {
  if (memberAxis === depthAxis) return 0;
  const t = geometry.wallThicknessM;

  if (geometry.kind === "cylinder" && geometry.axis === memberAxis) {
    const r = geometry.radiusM;
    const ri = t === undefined ? 0 : Math.max(0, r - t);
    return (Math.PI * (r ** 4 - ri ** 4)) / 4;
  }

  const widthAxis = OTHER_AXES[memberAxis].find((axis) => axis !== depthAxis)!;
  const d = extentAlongAxis(geometry, depthAxis);
  const b = extentAlongAxis(geometry, widthAxis);
  const outer = (b * d ** 3) / 12;
  if (t === undefined) return outer;
  const di = d - 2 * t;
  const bi = b - 2 * t;
  if (di <= 0 || bi <= 0) return outer;
  return outer - (bi * di ** 3) / 12;
}

/** Distance from the neutral axis to the extreme fibre for bending across `depthAxis`. */
export function extremeFibreDistanceM(
  geometry: ComponentGeometry,
  memberAxis: GeometryAxis,
  depthAxis: GeometryAxis,
): Meters {
  if (geometry.kind === "cylinder" && geometry.axis === memberAxis) return geometry.radiusM;
  return extentAlongAxis(geometry, depthAxis) / 2;
}

/** Elastic section modulus S = I / c, m³. */
export function elasticSectionModulusM3(
  geometry: ComponentGeometry,
  memberAxis: GeometryAxis,
  depthAxis: GeometryAxis,
): number {
  const c = extremeFibreDistanceM(geometry, memberAxis, depthAxis);
  if (!(c > 0)) return 0;
  return secondMomentOfAreaM4(geometry, memberAxis, depthAxis) / c;
}

/** Area and the weaker-axis stiffness of the section perpendicular to `memberAxis`. */
export function sectionProperties(
  geometry: ComponentGeometry,
  memberAxis: GeometryAxis,
  areaM2: number,
): SectionProperties {
  const [a, b] = OTHER_AXES[memberAxis];
  const minSecondMomentM4 = Math.min(
    secondMomentOfAreaM4(geometry, memberAxis, a),
    secondMomentOfAreaM4(geometry, memberAxis, b),
  );
  const minRadiusOfGyrationM = areaM2 > 0 ? Math.sqrt(minSecondMomentM4 / areaM2) : 0;
  return { areaM2, minSecondMomentM4, minRadiusOfGyrationM };
}

/* ------------------------------------------------------------------------------------ *
 * Column buckling
 * ------------------------------------------------------------------------------------ */

export interface BucklingResult {
  /** Effective slenderness ratio K·L / r. */
  readonly slendernessRatio: number;
  /** Slenderness at which Euler and Johnson curves meet: sqrt(2π²E / σy). */
  readonly transitionSlenderness: number;
  /** Critical compressive stress, Pa. */
  readonly criticalStressPa: Pascals;
  /** Critical axial load σcr · A, N. */
  readonly criticalLoadN: Newtons;
  readonly regime: "euler" | "johnson";
}

/**
 * Critical buckling load of an axially loaded column.
 *
 * Long columns (KL/r ≥ Cc) use Euler's formula:
 *     σcr = π²E / (KL/r)²          P_cr = π²EI / (KL)²
 * Short and intermediate columns (KL/r < Cc) use J. B. Johnson's parabola, which removes
 * Euler's unphysical prediction of stresses above yield for stocky members:
 *     σcr = σy − (σy² / 4π²E)·(KL/r)²
 * with the transition Cc = sqrt(2π²E / σy), where the two curves are tangent.
 *
 * DOCUMENTED ASSUMPTIONS: perfectly straight, concentrically loaded, prismatic column;
 * effective length factor K is a global setting (default 1.0, pinned–pinned) because
 * ForgeLab joints carry no rotational stiffness information yet. No residual stress,
 * no imperfection factors (as design codes such as AISC 360 or EN 1993-1-1 add).
 *
 * Reference: Timoshenko & Gere, Theory of Elastic Stability; Shigley's Mechanical
 * Engineering Design §4-14 (Euler and Johnson columns).
 */
export function columnBuckling(params: {
  lengthM: Meters;
  effectiveLengthFactor: number;
  section: SectionProperties;
  youngsModulusPa: Pascals;
  yieldStrengthPa: Pascals;
}): BucklingResult {
  const { section, youngsModulusPa: E, yieldStrengthPa: sy } = params;
  const transitionSlenderness = Math.sqrt((2 * Math.PI ** 2 * E) / sy);
  const r = section.minRadiusOfGyrationM;
  const slendernessRatio = r > 0 ? (params.effectiveLengthFactor * params.lengthM) / r : Infinity;

  if (slendernessRatio >= transitionSlenderness) {
    const criticalStressPa = (Math.PI ** 2 * E) / slendernessRatio ** 2;
    return {
      slendernessRatio,
      transitionSlenderness,
      criticalStressPa,
      criticalLoadN: criticalStressPa * section.areaM2,
      regime: "euler",
    };
  }
  const criticalStressPa = sy - (sy ** 2 / (4 * Math.PI ** 2 * E)) * slendernessRatio ** 2;
  return {
    slendernessRatio,
    transitionSlenderness,
    criticalStressPa,
    criticalLoadN: criticalStressPa * section.areaM2,
    regime: "johnson",
  };
}

/* ------------------------------------------------------------------------------------ *
 * Beam bending
 * ------------------------------------------------------------------------------------ */

/** A vertical point force on a beam at coordinate `atM` along its axis. Down is positive. */
export interface BeamPointLoad {
  readonly atM: Meters;
  readonly loadN: Newtons;
}

export interface BeamBendingInput {
  /** Beam extends from -lengthM/2 to +lengthM/2 along its own axis. */
  readonly lengthM: Meters;
  /** Self weight, spread uniformly along the full length. Down is positive. */
  readonly distributedLoadN: Newtons;
  /** Loads from things resting on the beam. */
  readonly pointLoads: readonly BeamPointLoad[];
  /** Coordinates of the support points along the beam axis. At least one. */
  readonly supportsAtM: readonly Meters[];
}

export interface BeamBendingResult {
  readonly maxMomentNm: number;
  readonly atM: Meters;
  /** Span between the outermost supports (0 for a single support). */
  readonly spanM: Meters;
  readonly idealisation: "simply-supported" | "cantilever";
}

/**
 * Peak bending moment in a beam under vertical load.
 *
 * IDEALISATION (documented):
 *  - With two or more supports the beam is treated as simply supported on its OUTERMOST
 *    two supports; intermediate supports are ignored. This is conservative — a continuous
 *    beam over interior supports has lower peak moments.
 *  - With one support (or all supports at one point) it is a cantilever built in at that
 *    point: the moment there is the larger of the two overhang moments.
 * Moments are found from statics by summing the moments of every force on one side of a
 * section, evaluated at every load point, support point and 64 evenly spaced stations.
 *
 * Checks against textbook cases: central point load on a simple span gives PL/4, uniform
 * load gives wL²/8, an end load on a cantilever gives PL. See members.test.ts.
 */
export function beamMaxBendingMoment(input: BeamBendingInput): BeamBendingResult {
  const half = input.lengthM / 2;
  const w = input.lengthM > 0 ? input.distributedLoadN / input.lengthM : 0;
  const supports = [...input.supportsAtM].sort((a, b) => a - b);
  const left = supports[0] ?? 0;
  const right = supports[supports.length - 1] ?? 0;
  const spanM = right - left;

  const stations = new Set<number>([-half, half, left, right]);
  for (const load of input.pointLoads) stations.add(clampTo(load.atM, -half, half));
  for (let i = 0; i <= 64; i += 1) stations.add(-half + (input.lengthM * i) / 64);
  const sorted = [...stations].sort((a, b) => a - b);

  // Moment at x from everything strictly on the left of x (sagging positive).
  // Down loads contribute -F·(x - xi); up reactions +R·(x - xi).
  const momentFromLeft = (x: number, reactions: readonly BeamPointLoad[]): number => {
    let m = 0;
    const loadedLength = Math.max(0, Math.min(x, half) + half);
    m -= w * loadedLength * (x - (-half + loadedLength / 2));
    for (const load of input.pointLoads) if (load.atM < x) m -= load.loadN * (x - load.atM);
    for (const reaction of reactions)
      if (reaction.atM < x) m += reaction.loadN * (x - reaction.atM);
    return m;
  };
  const momentFromRight = (x: number): number => {
    let m = 0;
    const loadedLength = Math.max(0, half - Math.max(x, -half));
    m -= w * loadedLength * (half - loadedLength / 2 - x);
    for (const load of input.pointLoads) if (load.atM > x) m -= load.loadN * (load.atM - x);
    return m;
  };

  if (spanM <= 1e-9) {
    // Cantilever about the single support: the left and right overhangs each hang off it.
    let best = { maxMomentNm: 0, atM: left };
    for (const x of sorted) {
      const m = x <= left ? momentFromLeft(x, []) : momentFromRight(x);
      if (Math.abs(m) > best.maxMomentNm) best = { maxMomentNm: Math.abs(m), atM: x };
    }
    // The built-in section carries the larger of the two overhang moments.
    const atSupport = Math.max(Math.abs(momentFromLeft(left, [])), Math.abs(momentFromRight(left)));
    if (atSupport >= best.maxMomentNm) best = { maxMomentNm: atSupport, atM: left };
    return { ...best, spanM: 0, idealisation: "cantilever" };
  }

  // Simply supported on the outermost supports: solve the two reactions by statics.
  const totalLoad = input.distributedLoadN + input.pointLoads.reduce((s, l) => s + l.loadN, 0);
  // Moment about the left support (distributed load acts at the beam centre, x = 0).
  let momentAboutLeft = input.distributedLoadN * (0 - left);
  for (const load of input.pointLoads) momentAboutLeft += load.loadN * (load.atM - left);
  const rightReaction = momentAboutLeft / spanM;
  const leftReaction = totalLoad - rightReaction;
  const reactions = [
    { atM: left, loadN: leftReaction },
    { atM: right, loadN: rightReaction },
  ];

  let best = { maxMomentNm: 0, atM: 0 };
  for (const x of sorted) {
    // Evaluate just to the right of each station so a force at x is included.
    const m = Math.abs(momentFromLeft(x + 1e-12, reactions));
    if (m > best.maxMomentNm) best = { maxMomentNm: m, atM: x };
  }
  return { ...best, spanM, idealisation: "simply-supported" };
}

function clampTo(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
