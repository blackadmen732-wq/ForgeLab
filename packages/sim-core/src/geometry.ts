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

export type ComponentGeometry = BoxGeometry | CylinderGeometry;

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
 * DOCUMENTED APPROXIMATION. ForgeLab Phase 0 treats every component as a short axially
 * loaded member: it takes the section perpendicular to whichever *local* axis is most
 * closely aligned with world vertical, and reports that section's material area. It does
 * not compute bending, buckling, shear or torsion, so a wide slab spanning two distant
 * supports is reported far stronger than it really is. See docs/ARCHITECTURE.md.
 */
/**
 * Cross-sectional area that resists the vertical load path, in square metres.
 *
 * DOCUMENTED APPROXIMATION. ForgeLab Phase 0 treats every component as a short axially
 * loaded member: it takes the section perpendicular to whichever *local* axis is most
 * closely aligned with world vertical, and reports that section's material area. It does
 * not compute bending, buckling, shear or torsion, so a wide slab spanning two distant
 * supports is reported far stronger than it really is. See docs/ARCHITECTURE.md.
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
