import {
  type CubicMeters,
  type Meters,
  type Quaternion,
  QuaternionMath,
  type SquareMeters,
  type Transform,
  UP,
  type Vec3,
  Vec3Math,
  assertPositive,
  localPointToWorld,
  vec3,
} from "@forgelab/shared";

/** Which local axis a cylinder's centre line runs along. */
export type GeometryAxis = "x" | "y" | "z";

/**
 * A rectangular prism centred on its local origin.
 * `sizeM` holds full extents, not half-extents.
 *
 * When `wallThicknessM` is present the box is a closed shell of that wall thickness
 * rather than a solid block. Shells matter because a solid steel reactor vessel would
 * weigh an order of magnitude more than a real one, and mass drives every structural
 * result downstream.
 */
export interface BoxGeometry {
  readonly kind: "box";
  readonly sizeM: Vec3;
  readonly wallThicknessM?: Meters;
}

/** A right circular cylinder centred on its local origin, running along `axis`. */
export interface CylinderGeometry {
  readonly kind: "cylinder";
  readonly radiusM: Meters;
  readonly heightM: Meters;
  readonly axis: GeometryAxis;
  readonly wallThicknessM?: Meters;
}

/**
 * A ring torus centred on its local origin, its symmetry axis along `axis`.
 * `majorRadiusM` is the distance from the axis to the centre of the tube; `minorRadiusM`
 * is the tube's outer radius. With `wallThicknessM` it is a hollow tube (a vessel).
 *
 * Added for V0.1 plant components: toroidal vacuum vessels, toroidal-field coil sets
 * and breeding blankets.
 */
export interface TorusGeometry {
  readonly kind: "torus";
  readonly majorRadiusM: Meters;
  readonly minorRadiusM: Meters;
  readonly axis: GeometryAxis;
  readonly wallThicknessM?: Meters;
}

/**
 * A bent tube: a circular tube of outer radius `radiusM` whose centreline is an arc of
 * radius `bendRadiusM` sweeping `sweepRad` (0 < sweep ≤ π) about the local `axis`.
 * The local origin is the midpoint of the centreline, where the tube runs along the
 * arc's tangent axis; the centre of curvature lies at −bendRadius along the radial axis
 * (see `arcFrame`). With `wallThicknessM` it is hollow — a vacuum-chamber bend or a
 * toroidal segment. Its two ends are open (flanged in a finished part).
 *
 * Mass, volumes and areas are exact (Pappus, swept fraction). The bounding box is made
 * symmetric about the origin (`geometryLocalHalfExtentsM`): on the inner side of the bend
 * it over-reaches by the bend's sagitta R(1 − cos(sweep/2)); the centre of mass is taken
 * at the origin, off by less than that sagitta. Documented approximations.
 */
export interface ArcGeometry {
  readonly kind: "arc";
  readonly bendRadiusM: Meters;
  readonly sweepRad: number;
  readonly radiusM: Meters;
  readonly axis: GeometryAxis;
  readonly wallThicknessM?: Meters;
}

export type ComponentGeometry = BoxGeometry | CylinderGeometry | TorusGeometry | ArcGeometry;

export function arcGeometry(
  bendRadiusM: Meters,
  sweepRad: number,
  radiusM: Meters,
  axis: GeometryAxis = "y",
  wallThicknessM?: Meters,
): ArcGeometry {
  assertPositive(bendRadiusM, "arcGeometry.bendRadiusM");
  assertPositive(radiusM, "arcGeometry.radiusM");
  if (!(sweepRad > 0 && sweepRad <= Math.PI + 1e-12))
    throw new RangeError("arcGeometry.sweepRad must be in (0, π].");
  if (!(radiusM < bendRadiusM))
    throw new RangeError("arcGeometry.radiusM must be smaller than bendRadiusM.");
  if (wallThicknessM === undefined)
    return Object.freeze({ kind: "arc", bendRadiusM, sweepRad, radiusM, axis });
  assertPositive(wallThicknessM, "arcGeometry.wallThicknessM");
  return Object.freeze({ kind: "arc", bendRadiusM, sweepRad, radiusM, axis, wallThicknessM });
}

/**
 * The local frame of an arc: `radial` points from the centre of curvature to the
 * centreline midpoint (the origin), `tangent` is the centreline direction there, and
 * `axis` is the axis the bend turns about. Right-handed: tangent = axis × radial.
 */
export function arcFrame(geometry: ArcGeometry): {
  readonly radial: Vec3;
  readonly tangent: Vec3;
  readonly axis: Vec3;
  readonly centre: Vec3;
} {
  const radial = geometry.axis === "x" ? vec3(0, 1, 0) : vec3(1, 0, 0);
  const axis =
    geometry.axis === "x" ? vec3(1, 0, 0) : geometry.axis === "y" ? vec3(0, 1, 0) : vec3(0, 0, 1);
  const tangent = Vec3Math.cross(axis, radial);
  return { radial, tangent, axis, centre: Vec3Math.scale(radial, -geometry.bendRadiusM) };
}

/** A point on the arc's centreline at angle t ∈ [−sweep/2, sweep/2] (0 = origin), local. */
export function arcPoint(geometry: ArcGeometry, t: number): Vec3 {
  const f = arcFrame(geometry);
  return Vec3Math.add(
    f.centre,
    Vec3Math.add(
      Vec3Math.scale(f.radial, geometry.bendRadiusM * Math.cos(t)),
      Vec3Math.scale(f.tangent, geometry.bendRadiusM * Math.sin(t)),
    ),
  );
}

/** The centreline direction at angle t (towards increasing t), local. */
export function arcTangent(geometry: ArcGeometry, t: number): Vec3 {
  const f = arcFrame(geometry);
  return Vec3Math.add(
    Vec3Math.scale(f.radial, -Math.sin(t)),
    Vec3Math.scale(f.tangent, Math.cos(t)),
  );
}

export function torusGeometry(
  majorRadiusM: Meters,
  minorRadiusM: Meters,
  axis: GeometryAxis = "y",
  wallThicknessM?: Meters,
): TorusGeometry {
  assertPositive(majorRadiusM, "torusGeometry.majorRadiusM");
  assertPositive(minorRadiusM, "torusGeometry.minorRadiusM");
  if (!(minorRadiusM < majorRadiusM)) {
    throw new RangeError("torusGeometry.minorRadiusM must be smaller than majorRadiusM.");
  }
  if (wallThicknessM === undefined) {
    return Object.freeze({ kind: "torus", majorRadiusM, minorRadiusM, axis });
  }
  assertPositive(wallThicknessM, "torusGeometry.wallThicknessM");
  return Object.freeze({ kind: "torus", majorRadiusM, minorRadiusM, axis, wallThicknessM });
}

/**
 * Volume enclosed by the inside of a hollow primitive (the vacuum or coolant space), m³.
 * Zero for solids.
 */
export function geometryInteriorVolumeM3(geometry: ComponentGeometry): CubicMeters {
  const t = geometry.wallThicknessM;
  if (t === undefined) return 0;
  switch (geometry.kind) {
    case "box": {
      const { x, y, z } = geometry.sizeM;
      return Math.max(0, x - 2 * t) * Math.max(0, y - 2 * t) * Math.max(0, z - 2 * t);
    }
    case "cylinder": {
      const ir = Math.max(0, geometry.radiusM - t);
      return Math.PI * ir * ir * Math.max(0, geometry.heightM - 2 * t);
    }
    case "torus": {
      const ia = Math.max(0, geometry.minorRadiusM - t);
      return 2 * Math.PI ** 2 * geometry.majorRadiusM * ia * ia;
    }
    case "arc": {
      const ia = Math.max(0, geometry.radiusM - t);
      return Math.PI * ia * ia * geometry.bendRadiusM * geometry.sweepRad;
    }
  }
}

/** Inner (wetted / vacuum-facing) surface area of a hollow primitive, m². Zero for solids. */
export function geometryInteriorSurfaceM2(geometry: ComponentGeometry): SquareMeters {
  const t = geometry.wallThicknessM;
  if (t === undefined) return 0;
  switch (geometry.kind) {
    case "box": {
      const x = Math.max(0, geometry.sizeM.x - 2 * t);
      const y = Math.max(0, geometry.sizeM.y - 2 * t);
      const z = Math.max(0, geometry.sizeM.z - 2 * t);
      return 2 * (x * y + y * z + x * z);
    }
    case "cylinder": {
      const ir = Math.max(0, geometry.radiusM - t);
      const ih = Math.max(0, geometry.heightM - 2 * t);
      return 2 * Math.PI * ir * ih + 2 * Math.PI * ir * ir;
    }
    case "torus": {
      const ia = Math.max(0, geometry.minorRadiusM - t);
      return 4 * Math.PI ** 2 * geometry.majorRadiusM * ia;
    }
    case "arc": {
      const ia = Math.max(0, geometry.radiusM - t);
      return 2 * Math.PI * ia * geometry.bendRadiusM * geometry.sweepRad;
    }
  }
}

/** Outer surface area, m². Used for convective and radiative loss to the surroundings. */
export function geometryOuterSurfaceM2(geometry: ComponentGeometry): SquareMeters {
  switch (geometry.kind) {
    case "box": {
      const { x, y, z } = geometry.sizeM;
      return 2 * (x * y + y * z + x * z);
    }
    case "cylinder": {
      const r = geometry.radiusM;
      return 2 * Math.PI * r * geometry.heightM + 2 * Math.PI * r * r;
    }
    case "torus":
      return 4 * Math.PI ** 2 * geometry.majorRadiusM * geometry.minorRadiusM;
    case "arc":
      return 2 * Math.PI * geometry.radiusM * geometry.bendRadiusM * geometry.sweepRad;
  }
}

export function boxGeometry(sizeM: Vec3, wallThicknessM?: Meters): BoxGeometry {
  assertPositive(sizeM.x, "boxGeometry.sizeM.x");
  assertPositive(sizeM.y, "boxGeometry.sizeM.y");
  assertPositive(sizeM.z, "boxGeometry.sizeM.z");
  if (wallThicknessM === undefined) return Object.freeze({ kind: "box", sizeM });
  assertPositive(wallThicknessM, "boxGeometry.wallThicknessM");
  return Object.freeze({ kind: "box", sizeM, wallThicknessM });
}

export function cylinderGeometry(
  radiusM: Meters,
  heightM: Meters,
  axis: GeometryAxis = "y",
  wallThicknessM?: Meters,
): CylinderGeometry {
  assertPositive(radiusM, "cylinderGeometry.radiusM");
  assertPositive(heightM, "cylinderGeometry.heightM");
  if (wallThicknessM === undefined) {
    return Object.freeze({ kind: "cylinder", radiusM, heightM, axis });
  }
  assertPositive(wallThicknessM, "cylinderGeometry.wallThicknessM");
  return Object.freeze({ kind: "cylinder", radiusM, heightM, axis, wallThicknessM });
}

/**
 * Material volume of the geometry in cubic metres.
 *
 * Solid primitives use their exact closed-form volume. Shells subtract the enclosed void:
 *  - box shell:      x*y*z - (x-2t)(y-2t)(z-2t)
 *  - cylinder shell: pi*r^2*h - pi*(r-t)^2*(h-2t)   (a capped tube)
 *  - torus (Pappus): 2*pi^2*R*a^2; shell 2*pi^2*R*(a^2 - (a-t)^2)
 * A wall thickness that would consume the whole part yields the solid volume.
 */
export function geometryVolumeM3(geometry: ComponentGeometry): CubicMeters {
  switch (geometry.kind) {
    case "box": {
      const { x, y, z } = geometry.sizeM;
      const outer = x * y * z;
      const t = geometry.wallThicknessM;
      if (t === undefined) return outer;
      const ix = x - 2 * t;
      const iy = y - 2 * t;
      const iz = z - 2 * t;
      if (ix <= 0 || iy <= 0 || iz <= 0) return outer;
      return outer - ix * iy * iz;
    }
    case "cylinder": {
      const { radiusM: r, heightM: h } = geometry;
      const outer = Math.PI * r * r * h;
      const t = geometry.wallThicknessM;
      if (t === undefined) return outer;
      const ir = r - t;
      const ih = h - 2 * t;
      if (ir <= 0 || ih <= 0) return outer;
      return outer - Math.PI * ir * ir * ih;
    }
    case "torus": {
      const { majorRadiusM: R, minorRadiusM: a } = geometry;
      const outer = 2 * Math.PI ** 2 * R * a * a;
      const t = geometry.wallThicknessM;
      if (t === undefined) return outer;
      const ia = a - t;
      if (ia <= 0) return outer;
      return outer - 2 * Math.PI ** 2 * R * ia * ia;
    }
    case "arc": {
      const { bendRadiusM: R, sweepRad: s, radiusM: a } = geometry;
      const outer = Math.PI * a * a * R * s;
      const t = geometry.wallThicknessM;
      if (t === undefined) return outer;
      const ia = a - t;
      if (ia <= 0) return outer;
      return outer - Math.PI * ia * ia * R * s;
    }
  }
}

/** Half-extents of the axis-aligned bounding box in the geometry's own local frame. */
export function geometryLocalHalfExtentsM(geometry: ComponentGeometry): Vec3 {
  switch (geometry.kind) {
    case "box":
      return Vec3Math.scale(geometry.sizeM, 0.5);
    case "cylinder": {
      const { radiusM: r, heightM: h, axis } = geometry;
      switch (axis) {
        case "x":
          return vec3(h / 2, r, r);
        case "y":
          return vec3(r, h / 2, r);
        case "z":
          return vec3(r, r, h / 2);
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "torus": {
      const { majorRadiusM: R, minorRadiusM: a, axis } = geometry;
      const outer = R + a;
      switch (axis) {
        case "x":
          return vec3(a, outer, outer);
        case "y":
          return vec3(outer, a, outer);
        case "z":
          return vec3(outer, outer, a);
      }
    }
    // eslint-disable-next-line no-fallthrough
    case "arc": {
      const { bendRadiusM: R, sweepRad: s, radiusM: a } = geometry;
      const f = arcFrame(geometry);
      const radial = R * (1 - Math.cos(s / 2)) + a;
      const tangent = R * Math.sin(Math.min(s, Math.PI) / 2) + a;
      const h = Vec3Math.add(
        Vec3Math.add(
          Vec3Math.scale(Vec3Math.abs(f.radial), radial),
          Vec3Math.scale(Vec3Math.abs(f.tangent), tangent),
        ),
        Vec3Math.scale(Vec3Math.abs(f.axis), a),
      );
      return h;
    }
  }
}

/**
 * Centre of mass of a single component in its own local frame.
 *
 * Every Milestone 0 primitive is homogeneous and symmetric about its local origin, so
 * this is the zero vector. The function exists because that stops being true the moment
 * we add flanged vessels, off-centre penetrations or internal structure, and every caller
 * already goes through it.
 */
export function geometryLocalCenterOfMassM(_geometry: ComponentGeometry): Vec3 {
  return Vec3Math.VEC3_ZERO;
}

/**
 * Cross-sectional area that resists the vertical load path, in square metres.
 *
 * It takes the section perpendicular to whichever *local* axis is most closely aligned
 * with world vertical and reports that section's material area. This is the direct
 * (axial) stress check. Bending and buckling are checked separately by
 * `systems/members.ts` (Structural 0.1); shear and torsion are not modelled.
 */
export function loadBearingAreaM2(geometry: ComponentGeometry, rotation: Quaternion): SquareMeters {
  const localUp = QuaternionMath.inverseRotateVec3(rotation, UP);
  return sectionAreaPerpendicularToLocalAxis(geometry, dominantAxis(localUp));
}

/**
 * Material area of the section cut perpendicular to a local axis, in square metres.
 *
 * For a shell this is the wall area only, not the enclosed opening: a tube loaded along
 * its axis resists on its annulus, not on its bore.
 */
export function sectionAreaPerpendicularToLocalAxis(
  geometry: ComponentGeometry,
  axis: GeometryAxis,
): SquareMeters {
  switch (geometry.kind) {
    case "box": {
      const { x, y, z } = geometry.sizeM;
      const [a, b] = axis === "x" ? [y, z] : axis === "y" ? [x, z] : [x, y];
      const outer = a * b;
      const t = geometry.wallThicknessM;
      if (t === undefined) return outer;
      const ia = a - 2 * t;
      const ib = b - 2 * t;
      if (ia <= 0 || ib <= 0) return outer;
      return outer - ia * ib;
    }
    case "cylinder": {
      const { radiusM: r, heightM: h, axis: cylinderAxis } = geometry;
      const t = geometry.wallThicknessM;
      if (axis === cylinderAxis) {
        const outer = Math.PI * r * r;
        if (t === undefined) return outer;
        const ir = r - t;
        if (ir <= 0) return outer;
        return outer - Math.PI * ir * ir;
      }
      // Cut across the axis: the rectangular mid-plane section through the tube.
      const outer = 2 * r * h;
      if (t === undefined) return outer;
      const ir = r - t;
      const ih = h - 2 * t;
      if (ir <= 0 || ih <= 0) return outer;
      return outer - 2 * ir * ih;
    }
    case "torus": {
      const { majorRadiusM: R, minorRadiusM: a, axis: torusAxis } = geometry;
      const t = geometry.wallThicknessM;
      const tube = t === undefined || t >= a ? a : undefined;
      if (axis === torusAxis) {
        // A plane perpendicular to the axis cuts two concentric annuli: 4*pi*R*a (solid)
        // or exactly 4*pi*R*t for a shell.
        return tube !== undefined ? 4 * Math.PI * R * a : 4 * Math.PI * R * t!;
      }
      // A plane containing the axis cuts the tube twice.
      if (tube !== undefined) return 2 * Math.PI * a * a;
      const ia = a - t!;
      return 2 * Math.PI * (a * a - ia * ia);
    }
    case "arc": {
      // The tube's own annulus, whichever way it is cut (a bend is a short member).
      const a = geometry.radiusM;
      const t = geometry.wallThicknessM;
      if (t === undefined || t >= a) return Math.PI * a * a;
      const ia = a - t;
      return Math.PI * (a * a - ia * ia);
    }
  }
}

/** The local axis a direction vector points most strongly along. */
export function dominantLocalAxis(direction: Vec3): GeometryAxis {
  return dominantAxis(direction);
}

function dominantAxis(v: Vec3): GeometryAxis {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ay >= ax && ay >= az) return "y";
  if (ax >= az) return "x";
  return "z";
}

export interface Aabb {
  readonly minM: Vec3;
  readonly maxM: Vec3;
}

/**
 * World-space axis-aligned bounding box.
 *
 * Computed by rotating the eight corners of the local bounding box, so it is exact for
 * boxes and conservative (never too small) for cylinders. Ground contact and support
 * geometry are resolved against this box.
 */
export function worldAabb(geometry: ComponentGeometry, transform: Transform): Aabb {
  const h = geometryLocalHalfExtentsM(geometry);
  let min = vec3(Infinity, Infinity, Infinity);
  let max = vec3(-Infinity, -Infinity, -Infinity);

  for (let i = 0; i < 8; i += 1) {
    const corner = vec3(
      (i & 1) === 0 ? -h.x : h.x,
      (i & 2) === 0 ? -h.y : h.y,
      (i & 4) === 0 ? -h.z : h.z,
    );
    const world = localPointToWorld(transform, corner);
    min = Vec3Math.minComponents(min, world);
    max = Vec3Math.maxComponents(max, world);
  }

  return Object.freeze({ minM: min, maxM: max });
}

/** Lowest world-space Y of the component's bounding box. */
export function worldBottomY(geometry: ComponentGeometry, transform: Transform): Meters {
  return worldAabb(geometry, transform).minM.y;
}
