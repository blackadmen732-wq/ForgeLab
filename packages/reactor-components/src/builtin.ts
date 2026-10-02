import { MaterialIds, type MaterialId } from "@forgelab/materials";
import { type Vec3, Vec3Math, vec3 } from "@forgelab/shared";
import {
  type ComponentGeometry,
  type ComponentSpec,
  type ConnectionType,
  type PlantRole,
  arcGeometry,
  boxGeometry,
  cylinderGeometry,
  geometryLocalHalfExtentsM,
  torusGeometry,
} from "@forgelab/sim-core";
import { V01_PORTS, V01_PRODUCTS, type PortSource } from "./products.js";
import {
  buildConnectionPoints,
  productComposition,
  type ProductInfo,
  type ComponentCategory,
  type ComponentDefinition,
  type DimensionSpec,
  type PlacementOptions,
  type SocketTemplate,
} from "./definition.js";

/**
 * ForgeLab's V0.1 component library.
 *
 * Every dimension is a plain engineering choice in metres, and every preset parameter is a
 * representative value for the kind of plant the part stands in for (ITER-class where a
 * reference exists). None of them is tuned to make a design succeed or fail: mass, loads,
 * fields, temperatures and power all follow from these numbers through sim-core's
 * documented physics. Every preset can be changed in the inspector.
 */

/* ------------------------------------------------------------------------------------ *
 * Socket helpers
 * ------------------------------------------------------------------------------------ */

function structural(id: string, localPosition: Vec3, localDirection: Vec3): SocketTemplate {
  return { id, localPosition, localDirection, connectionType: "structural", derivedCapacity: true };
}
function mount(id: string, localPosition: Vec3, localDirection: Vec3): SocketTemplate {
  return { id, localPosition, localDirection, connectionType: "mount", derivedCapacity: false };
}
function socket(
  id: string,
  connectionType: ConnectionType,
  localPosition: Vec3,
  localDirection: Vec3,
): SocketTemplate {
  return { id, localPosition, localDirection, connectionType, derivedCapacity: false };
}

const UP = vec3(0, 1, 0);
const DOWN = vec3(0, -1, 0);
const PX = vec3(1, 0, 0);
const NX = vec3(-1, 0, 0);
const PZ = vec3(0, 0, 1);
const NZ = vec3(0, 0, -1);

/** A base socket at the bottom of a part of height h, so it can stand on a deck. */
const base = (h: number) => structural("base", vec3(0, -h / 2, 0), DOWN);

interface Shape {
  readonly geometry: ComponentGeometry;
  readonly sockets: readonly SocketTemplate[];
}

interface Recipe {
  readonly type: string;
  readonly name: string;
  readonly description: string;
  readonly category: ComponentCategory;
  readonly role: PlantRole;
  readonly material: MaterialId;
  readonly dimensions: readonly DimensionSpec[];
  /** Geometry and sockets from clamped dimensions, in metres. */
  readonly shape: (d: Readonly<Record<string, number>>) => Shape;
  readonly dimensionsOf: (geometry: ComponentGeometry) => Record<string, number>;
  readonly presets?: Readonly<Record<string, number | boolean | string>>;
  readonly keyProperty: string;
  /** Product sheet; V0.1 parts take theirs from products.ts. */
  readonly product?: ProductInfo;
  /** Typed port per socket id; V0.1 parts take theirs from products.ts. */
  readonly ports?: Readonly<Record<string, PortSource>>;
}

const dim = (
  key: string,
  label: string,
  defaultM: number,
  minM: number,
  maxM: number,
): DimensionSpec => ({
  key,
  label,
  defaultM,
  minM,
  maxM,
});

function resolveDimensions(
  specs: readonly DimensionSpec[],
  input: Readonly<Record<string, number>> = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of specs) {
    const raw = input[spec.key];
    const value = typeof raw === "number" && Number.isFinite(raw) ? raw : spec.defaultM;
    out[spec.key] = Math.min(spec.maxM, Math.max(spec.minM, value));
  }
  return out;
}

function sizeOf(geometry: ComponentGeometry): Vec3 {
  switch (geometry.kind) {
    case "box":
      return geometry.sizeM;
    case "cylinder": {
      const d = 2 * geometry.radiusM;
      const h = geometry.heightM;
      return geometry.axis === "x"
        ? vec3(h, d, d)
        : geometry.axis === "y"
          ? vec3(d, h, d)
          : vec3(d, d, h);
    }
    case "torus": {
      const outer = 2 * (geometry.majorRadiusM + geometry.minorRadiusM);
      return vec3(outer, 2 * geometry.minorRadiusM, outer);
    }
    case "arc":
      return Vec3Math.scale(geometryLocalHalfExtentsM(geometry), 2);
  }
}

function define(input: Recipe): ComponentDefinition {
  const product = input.product ?? V01_PRODUCTS[input.type];
  if (product === undefined) throw new Error(`No product sheet for "${input.type}".`);
  const ports = input.ports ?? V01_PORTS[input.type] ?? {};
  const recipe: Recipe = {
    ...input,
    shape: (d) => {
      const shape = input.shape(d);
      return {
        ...shape,
        sockets: shape.sockets.map((socket) => {
          const source = ports[socket.id];
          if (source === undefined || socket.port !== undefined) return socket;
          return { ...socket, port: typeof source === "function" ? source(d) : source };
        }),
      };
    },
  };
  const composition = productComposition(product);
  const defaults = resolveDimensions(recipe.dimensions);
  const defaultShape = recipe.shape(defaults);
  return {
    type: recipe.type,
    name: recipe.name,
    description: recipe.description,
    defaultMaterialId: recipe.material,
    nominalSizeM: sizeOf(defaultShape.geometry),
    category: recipe.category,
    role: recipe.role,
    presetParameters: recipe.presets ?? {},
    keyProperty: recipe.keyProperty,
    dimensions: recipe.dimensions,
    product,
    createSpec(options: PlacementOptions): ComponentSpec {
      const materialId = options.materialId ?? recipe.material;
      const { geometry, sockets } =
        options.dimensions === undefined
          ? defaultShape
          : recipe.shape(resolveDimensions(recipe.dimensions, options.dimensions));
      return {
        id: options.id,
        type: recipe.type,
        geometry,
        materialId,
        connectionPoints: buildConnectionPoints(sockets, geometry, materialId),
        role: recipe.role,
        parameters: { ...(recipe.presets ?? {}), ...(options.parameters ?? {}) },
        ...(composition === undefined ? {} : { composition }),
        ...(options.transform === undefined ? {} : { transform: options.transform }),
        ...(options.label === undefined ? {} : { label: options.label }),
        ...(options.anchored === undefined ? {} : { anchored: options.anchored }),
        ...(options.additionalMassKg === undefined
          ? {}
          : { additionalMassKg: options.additionalMassKg }),
      };
    },
    reshape(dimensions, materialId) {
      const { geometry, sockets } = recipe.shape(resolveDimensions(recipe.dimensions, dimensions));
      return { geometry, connectionPoints: buildConnectionPoints(sockets, geometry, materialId) };
    },
    dimensionsOf(geometry) {
      return resolveDimensions(recipe.dimensions, recipe.dimensionsOf(geometry));
    },
  };
}

/* ------------------------------------------------------------------------------------ *
 * Structure (Milestone 0 parts, unchanged geometry and sockets)
 * ------------------------------------------------------------------------------------ */

/**
 * Structural Beam — a square hollow section (default 150 x 150 x 8 mm, 4 m long) lying
 * along its local X axis. A hollow section because nobody builds frames from solid bar:
 * the solid version would weigh six times as much. Spans horizontally or, rotated, stands
 * as a column.
 */
export const STRUCTURAL_BEAM = define({
  type: "structural-beam",
  name: "Structural Beam",
  description:
    "Square hollow section, 150 x 150 x 8 mm and 4 m long by default. Spans horizontally or stands as a column when rotated.",
  category: "Structure",
  role: "structure",
  material: MaterialIds.StructuralSteel,
  dimensions: [
    dim("lengthM", "Length", 4, 0.5, 30),
    dim("sectionM", "Section width", 0.15, 0.04, 1.5),
    dim("wallM", "Wall thickness", 0.008, 0.002, 0.1),
  ],
  shape: (d) => {
    const L = d["lengthM"]!;
    const b = d["sectionM"]!;
    const t = Math.min(d["wallM"]!, b / 2.5);
    return {
      geometry: boxGeometry(vec3(L, b, b), t),
      sockets: [
        structural("end-a", vec3(-L / 2, 0, 0), NX),
        structural("end-b", vec3(L / 2, 0, 0), PX),
        structural("top", vec3(0, b / 2, 0), UP),
        structural("bottom", vec3(0, -b / 2, 0), DOWN),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "box"
      ? { lengthM: g.sizeM.x, sectionM: g.sizeM.y, wallM: g.wallThicknessM ?? 0.008 }
      : {},
  keyProperty: "4 m · 150 SHS",
});

/**
 * Structural Platform — a square deck (default 6 m, 200 mm deep) built as a 12 mm plate
 * box, with a socket on top and four inset corner sockets underneath.
 */
export const STRUCTURAL_PLATFORM = define({
  type: "structural-platform",
  name: "Structural Platform",
  description:
    "Square deck, 6 m and 200 mm deep in 12 mm plate by default, with four inset corner mounts underneath and a central mount on top.",
  category: "Structure",
  role: "structure",
  material: MaterialIds.StructuralSteel,
  dimensions: [
    dim("spanM", "Span", 6, 1.5, 30),
    dim("depthM", "Depth", 0.2, 0.05, 2),
    dim("plateM", "Plate thickness", 0.012, 0.003, 0.1),
  ],
  shape: (d) => {
    const span = d["spanM"]!;
    const depth = d["depthM"]!;
    const plate = Math.min(d["plateM"]!, depth / 2.5);
    const corner = span / 2 - Math.min(0.3, span / 10);
    return {
      geometry: boxGeometry(vec3(span, depth, span), plate),
      sockets: [
        structural("top", vec3(0, depth / 2, 0), UP),
        structural("bottom-nx-nz", vec3(-corner, -depth / 2, -corner), DOWN),
        structural("bottom-nx-pz", vec3(-corner, -depth / 2, corner), DOWN),
        structural("bottom-px-nz", vec3(corner, -depth / 2, -corner), DOWN),
        structural("bottom-px-pz", vec3(corner, -depth / 2, corner), DOWN),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "box"
      ? { spanM: g.sizeM.x, depthM: g.sizeM.y, plateM: g.wallThicknessM ?? 0.012 }
      : {},
  keyProperty: "6 × 6 m deck",
});

/**
 * Cryostat — the vacuum-insulated stainless shell that encloses a superconducting
 * tokamak (ITER: 304L, about 29 m across and 29 m tall, 3 850 t). Here it is the shell
 * and its mass: its insulation vacuum and thermal shield are not modelled yet, so it does
 * not change what reaches the cold magnets.
 */
export const CRYOSTAT = define({
  type: "cryostat",
  name: "Cryostat",
  description:
    "304L stainless shell around the whole machine, 29 m across and 26 m tall with a 100 mm wall by default (≈3 000 t). Structure and mass only: its insulation vacuum and thermal shield are not modelled yet.",
  category: "Chambers",
  role: "structure",
  material: MaterialIds.Stainless304L,
  dimensions: [
    dim("radiusM", "Radius", 14.6, 2, 30),
    dim("heightM", "Height", 26, 2, 45),
    dim("wallM", "Wall thickness", 0.1, 0.01, 0.5),
  ],
  shape: (d) => {
    const r = d["radiusM"]!;
    const h = d["heightM"]!;
    const t = Math.min(d["wallM"]!, r / 10, h / 10);
    return {
      geometry: cylinderGeometry(r, h, "y", t),
      sockets: [
        structural("base", vec3(0, -h / 2, 0), DOWN),
        structural("lid", vec3(0, h / 2, 0), UP),
        mount("ring-px", vec3(r, 0, 0), PX),
        mount("ring-nx", vec3(-r, 0, 0), NX),
        mount("ring-pz", vec3(0, 0, r), PZ),
        mount("ring-nz", vec3(0, 0, -r), NZ),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder"
      ? { radiusM: g.radiusM, heightM: g.heightM, wallM: g.wallThicknessM ?? 0.1 }
      : {},
  keyProperty: "Ø29 m · 304L",
});

/**
 * Stair Tower — switchback steel stairs with landings, for reaching platforms. Its mass is
 * that of an equivalent thin steel shell over its envelope (a stair tower is mostly air).
 */
export const STAIR_TOWER = define({
  type: "stair-tower",
  name: "Stair Tower",
  description:
    "Switchback steel stairs with a landing every 3.6 m, 12 m tall by default. Its mass is an equivalent 4 mm steel shell over the envelope.",
  category: "Structure",
  role: "structure",
  material: MaterialIds.StructuralSteel,
  dimensions: [
    dim("heightM", "Height", 12, 2, 40),
    dim("widthM", "Width", 3, 1.5, 6),
    dim("runM", "Run", 6, 3, 12),
  ],
  shape: (d) => {
    const h = d["heightM"]!;
    const w = d["widthM"]!;
    const run = d["runM"]!;
    return {
      geometry: boxGeometry(vec3(w, h, run), 0.004),
      sockets: [
        structural("base", vec3(0, -h / 2, 0), DOWN),
        structural("top", vec3(0, h / 2, 0), UP),
        mount("landing", vec3(w / 2, h / 2, 0), PX),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "box" ? { heightM: g.sizeM.y, widthM: g.sizeM.x, runM: g.sizeM.z } : {},
  keyProperty: "12 m · steel",
});

/** Equipment Block — a solid aluminium cube standing in for unspecified plant. */
export const EQUIPMENT_BLOCK = define({
  type: "equipment-block",
  name: "Equipment Block",
  description:
    "Solid cube (1 m by default) standing in for an unspecified piece of plant. Has mass and occupies space; nothing else.",
  category: "Structure",
  role: "structure",
  material: MaterialIds.Aluminum,
  dimensions: [dim("sizeM", "Edge length", 1, 0.2, 10)],
  shape: (d) => {
    const e = d["sizeM"]!;
    const h = e / 2;
    return {
      geometry: boxGeometry(vec3(e, e, e)),
      sockets: [
        structural("bottom", vec3(0, -h, 0), DOWN),
        structural("top", vec3(0, h, 0), UP),
        mount("side-nx", vec3(-h, 0, 0), NX),
        mount("side-px", vec3(h, 0, 0), PX),
        mount("side-nz", vec3(0, 0, -h), NZ),
        mount("side-pz", vec3(0, 0, h), PZ),
      ],
    };
  },
  dimensionsOf: (g) => (g.kind === "box" ? { sizeM: g.sizeM.x } : {}),
  keyProperty: "1 m cube",
});

/* ------------------------------------------------------------------------------------ *
 * Chambers
 * ------------------------------------------------------------------------------------ */

/**
 * Cylindrical Vacuum Chamber — the Milestone 0 "reactor chamber" (same default geometry
 * and structural sockets), now a vacuum vessel. With coaxial solenoids around it, it holds
 * a linear plasma. Linear configurations are always "experimental" in V0.1.
 */
export const REACTOR_CHAMBER = define({
  type: "reactor-chamber",
  name: "Cylindrical Vacuum Chamber",
  description:
    "316L vessel, 3 m tall and 1.5 m in radius with a 50 mm wall by default. Surround it with solenoid coils for a linear (open) plasma — an experimental configuration.",
  category: "Chambers",
  role: "vacuum-vessel",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("radiusM", "Radius", 1.5, 0.2, 10),
    dim("heightM", "Height", 3, 0.5, 40),
    dim("wallM", "Wall thickness", 0.05, 0.005, 0.5),
  ],
  shape: (d) => {
    const r = d["radiusM"]!;
    const h = d["heightM"]!;
    const t = Math.min(d["wallM"]!, r / 3, h / 6);
    const y = Math.min(0.8, h / 4);
    return {
      geometry: cylinderGeometry(r, h, "y", t),
      sockets: [
        structural("base", vec3(0, -h / 2, 0), DOWN),
        structural("top", vec3(0, h / 2, 0), UP),
        mount("port-nx", vec3(-r, 0, 0), NX),
        mount("port-px", vec3(r, 0, 0), PX),
        mount("port-nz", vec3(0, 0, -r), NZ),
        mount("port-pz", vec3(0, 0, r), PZ),
        socket("vacuum", "vacuum", vec3(r, -y, 0), PX),
        socket("fuel", "fuel", vec3(-r, -y, 0), NX),
        socket("heating", "port", vec3(0, -y, r), PZ),
        socket("coolant-in", "coolant", vec3(0, y, -r), NZ),
        socket("coolant-out", "coolant", vec3(0, -y, -r), NZ),
        socket("sensor", "control", vec3(0, h / 2, r / 2), UP),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder"
      ? { radiusM: g.radiusM, heightM: g.heightM, wallM: g.wallThicknessM ?? 0.05 }
      : {},
  presets: { channelDiameterM: 0.3, channelLengthM: 10 },
  keyProperty: "Ø3 m · 21 m³",
});

/*
 * Chamber segments: build a vacuum chamber of any shape. Segments joined flange to flange
 * share one vacuum; a closed ring holds a toroidal plasma, a capped column a linear one
 * (sim-core plant/chamber.ts). An end flange left open lets the hall's air in. Tubes run
 * along local z (straight) or bend about local y (bends), so a radial array of bends round
 * the vertical axis closes a horizontal ring.
 */
const SEGMENT_DIMS = [
  dim("tubeRadiusM", "Tube radius", 1, 0.2, 5),
  dim("wallM", "Wall thickness", 0.04, 0.005, 0.3),
];

/**
 * Sockets common to every segment, round the tube's middle cross-section (x outboard,
 * y up): a foot, wall cooling on the inboard side, and spare service ports outboard —
 * pumping low, fuel high, heating on the midplane, diagnostics on top. A pump, injector
 * or heater on any segment serves the whole chamber; unused ports are blanked off.
 */
function segmentServices(r: number): SocketTemplate[] {
  const k = Math.SQRT1_2;
  return [
    structural("foot", vec3(0, -r, 0), DOWN),
    socket("coolant-in", "coolant", vec3(-r, 0.25 * r, 0), NX),
    socket("coolant-out", "coolant", vec3(-r, -0.25 * r, 0), NX),
    socket("vacuum", "vacuum", vec3(k * r, -k * r, 0), vec3(k, -k, 0)),
    socket("fuel", "fuel", vec3(k * r, k * r, 0), vec3(k, k, 0)),
    socket("heating", "port", vec3(r, 0, 0), PX),
    socket("sensor", "control", vec3(0, r, 0), UP),
  ];
}

function straightShape(d: Readonly<Record<string, number>>) {
  const r = d["tubeRadiusM"]!;
  const L = d["lengthM"]!;
  const t = Math.min(d["wallM"]!, r / 3, L / 6);
  return {
    geometry: cylinderGeometry(r, L, "z", t),
    r,
    L,
    ends: [
      socket("flange-a", "vacuum", vec3(0, 0, -L / 2), NZ),
      socket("flange-b", "vacuum", vec3(0, 0, L / 2), PZ),
    ],
  };
}

const straightDims = (g: ComponentGeometry) =>
  g.kind === "cylinder"
    ? { tubeRadiusM: g.radiusM, lengthM: g.heightM, wallM: g.wallThicknessM ?? 0.04 }
    : {};

/** Small-machine plasma defaults: a 15 MA ITER current would tear a 2 m ring apart. */
const SEGMENT_PRESETS = {
  plasmaCurrentA: 1e6,
  coolantConductanceWK: 2e6,
  channelDiameterM: 0.15,
  channelLengthM: 6,
} as const;

export const CHAMBER_STRAIGHT = define({
  type: "chamber-straight",
  name: "Straight Chamber Segment",
  description:
    "A flanged 316L vacuum tube, 2 m long and 1 m in radius by default. Join segments end to end: a closed ring holds a toroidal plasma, a capped column a linear one. An open end flange lets air in. Spare ports take a pump, fuel, heating or diagnostics for the whole chamber.",
  category: "Chambers",
  role: "vacuum-vessel",
  material: MaterialIds.StainlessSteel,
  dimensions: [dim("lengthM", "Length", 2, 0.3, 20), ...SEGMENT_DIMS],
  shape: (d) => {
    const { geometry, r, ends } = straightShape(d);
    return { geometry, sockets: [...ends, ...segmentServices(r)] };
  },
  dimensionsOf: straightDims,
  presets: SEGMENT_PRESETS,
  keyProperty: "2 m · flanged",
});

export const CHAMBER_BEND = define({
  type: "chamber-bend",
  name: "Bend Segment",
  description:
    "A curved, flanged 316L vacuum tube: 45° of a 4 m bend radius by default. Eight of them, radially arrayed, close a ring — a toroidal chamber you built yourself.",
  category: "Chambers",
  role: "vacuum-vessel",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("bendRadiusM", "Bend radius", 4, 0.6, 20),
    dim("sweepDeg", "Sweep angle", 45, 5, 180),
    ...SEGMENT_DIMS,
  ],
  shape: (d) => {
    const R = d["bendRadiusM"]!;
    const s = (d["sweepDeg"]! * Math.PI) / 180;
    const r = Math.min(d["tubeRadiusM"]!, 0.8 * R);
    const t = Math.min(d["wallM"]!, r / 3);
    // Bends about local y: radial +x, tangent −z (sim-core arcFrame). The ends sit at
    // ±sweep/2 from the origin, facing out along the centreline.
    const c = Math.cos(s / 2);
    const n = Math.sin(s / 2);
    return {
      geometry: arcGeometry(R, s, r, "y", t),
      sockets: [
        socket("flange-a", "vacuum", vec3(-R + R * c, 0, R * n), vec3(-n, 0, c)),
        socket("flange-b", "vacuum", vec3(-R + R * c, 0, -R * n), vec3(-n, 0, -c)),
        ...segmentServices(r),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "arc"
      ? {
          bendRadiusM: g.bendRadiusM,
          sweepDeg: (g.sweepRad * 180) / Math.PI,
          tubeRadiusM: g.radiusM,
          wallM: g.wallThicknessM ?? 0.04,
        }
      : {},
  presets: SEGMENT_PRESETS,
  keyProperty: "45° · R 4 m",
});

export const CHAMBER_END_CAP = define({
  type: "chamber-end-cap",
  name: "Chamber End Cap",
  description:
    "A dished 316L head that closes one end of a chamber column. Fit one to each open end of a linear chamber.",
  category: "Chambers",
  role: "vacuum-vessel",
  material: MaterialIds.StainlessSteel,
  dimensions: [...SEGMENT_DIMS],
  shape: (d) => {
    const r = d["tubeRadiusM"]!;
    const L = Math.max(0.2, 0.3 * r);
    const t = Math.min(d["wallM"]!, r / 3, L / 6);
    return {
      geometry: cylinderGeometry(r, L, "z", t),
      sockets: [
        socket("flange", "vacuum", vec3(0, 0, L / 2), PZ),
        structural("foot", vec3(0, -r, 0), DOWN),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder" ? { tubeRadiusM: g.radiusM, wallM: g.wallThicknessM ?? 0.04 } : {},
  presets: SEGMENT_PRESETS,
  keyProperty: "blank end",
});

/** Feet under a torus and cradles in its bore, so nested tori stack on each other. */
function torusSupports(R: number, a: number, t: number): SocketTemplate[] {
  const out: SocketTemplate[] = [];
  const positions: [string, number, number][] = [
    ["px", R, 0],
    ["nx", -R, 0],
    ["pz", 0, R],
    ["nz", 0, -R],
  ];
  for (const [suffix, x, z] of positions) {
    out.push(structural(`foot-${suffix}`, vec3(x, -a, z), DOWN));
    out.push(structural(`cradle-${suffix}`, vec3(x, -(a - t), z), UP));
  }
  return out;
}

const torusDims = (g: ComponentGeometry) =>
  g.kind === "torus"
    ? { majorRadiusM: g.majorRadiusM, tubeRadiusM: g.minorRadiusM, wallM: g.wallThicknessM ?? 0.1 }
    : {};

/** Clamps torus dimensions so the tube never reaches the axis and the wall fits the tube. */
function torusShape(d: Readonly<Record<string, number>>) {
  const R = d["majorRadiusM"]!;
  const a = Math.min(d["tubeRadiusM"]!, 0.95 * R);
  const t = Math.min(d["wallM"]!, 0.9 * a);
  return { R, a, t, geometry: torusGeometry(R, a, "y", t) };
}

/**
 * Tokamak Vacuum Vessel — a 316L torus, default R = 6.2 m, tube radius 2.3 m, 60 mm wall.
 * The plasma fills 90 % of the tube radius (a ≈ 2.0 m), close to ITER's R 6.2 m, a 2.0 m.
 */
export const TOKAMAK_VESSEL = define({
  type: "tokamak-vessel",
  name: "Tokamak Vacuum Vessel",
  description:
    "Toroidal 316L vessel, major radius 6.2 m, tube radius 2.3 m, 60 mm wall by default. Sets the plasma current, shape and wall; it is also the first wall and must be cooled.",
  category: "Chambers",
  role: "vacuum-vessel",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("majorRadiusM", "Major radius R", 6.2, 1, 15),
    dim("tubeRadiusM", "Tube radius", 2.3, 0.3, 6),
    dim("wallM", "Wall thickness", 0.06, 0.01, 0.5),
  ],
  shape: (d) => {
    const { R, a, geometry } = torusShape(d);
    const t = geometry.kind === "torus" ? (geometry.wallThicknessM ?? 0) : 0;
    const port = Math.min(0.6, a / 3);
    return {
      geometry,
      sockets: [
        ...torusSupports(R, a, t),
        socket("vacuum", "vacuum", vec3(R + a, -port, 0), PX),
        socket("fuel", "fuel", vec3(-(R + a), 0, 0), NX),
        socket("heating", "port", vec3(0, 0, R + a), PZ),
        socket("coolant-in", "coolant", vec3(0, port, -(R + a)), NZ),
        socket("coolant-out", "coolant", vec3(0, -port, -(R + a)), NZ),
        socket("sensor", "control", vec3(R, a, 0), UP),
      ],
    };
  },
  dimensionsOf: torusDims,
  presets: {
    plasmaCurrentA: 15e6,
    elongation: 1.7,
    coolantConductanceWK: 50e6,
    channelDiameterM: 0.8,
    channelLengthM: 30,
  },
  keyProperty: "R 6.2 m · 15 MA",
});

/* ------------------------------------------------------------------------------------ *
 * Magnets
 * ------------------------------------------------------------------------------------ */

/**
 * Toroidal-Field Coil Set — the TF coils treated as one continuous toroidal winding inside
 * a 316L casing torus (default R 6.2 m, tube radius 4.35 m, 0.8 m casing). 2412 turns at
 * 68 kA (ITER: 18 coils × 134 turns × 68 kA) give 5.3 T at the plasma centre.
 */
export const TF_COIL_SET = define({
  type: "tf-coil-set",
  name: "Toroidal-Field Coil Set",
  description:
    "Nb₃Sn toroidal-field winding in a 316L casing that encloses the vessel and blanket. 2412 turns × 68 kA → 5.3 T at R = 6.2 m. Needs a cryoplant (electrical) and shielding from neutrons.",
  category: "Magnets",
  role: "magnet-coil",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("majorRadiusM", "Major radius R", 6.2, 1, 15),
    dim("tubeRadiusM", "Tube radius", 4.35, 0.5, 10),
    dim("wallM", "Casing thickness", 0.8, 0.05, 3),
  ],
  shape: (d) => {
    const { R, a, geometry } = torusShape(d);
    const t = geometry.kind === "torus" ? (geometry.wallThicknessM ?? 0) : 0;
    return {
      geometry,
      sockets: [
        ...torusSupports(R, a, t),
        socket("power", "electrical", vec3(R + a, 0, 0), PX),
        socket("coolant-in", "coolant", vec3(0, 0.6, R + a), PZ),
        socket("coolant-out", "coolant", vec3(0, -0.6, R + a), PZ),
        socket("sensor", "control", vec3(-R, a, 0), UP),
      ],
    };
  },
  dimensionsOf: torusDims,
  presets: {
    turns: 2412,
    currentA: 68000,
    superconducting: true,
    conductor: "nb3sn",
    cryoCapacityW: 30e3,
  },
  keyProperty: "5.3 T · SC",
});

/**
 * Circular Coil — one superconducting loop coil: a winding pack of radius a carried round
 * a ring of radius R in a steel case, standing upright (its axis along local Z). Arrange
 * many with the radial-array tool to make a toroidal-field ring of your own, stack them
 * for a mirror or a solenoid. Its field is computed from its geometry (Biot–Savart), so
 * whatever arrangement you build is the arrangement the plasma sees.
 */
export const CIRCULAR_COIL = define({
  type: "circular-coil",
  name: "Circular Coil",
  description:
    "One superconducting loop coil in a 316L case — 3 m ring, 100 turns × 50 kA by default. Ring them round a vessel with the radial array (Ctrl Shift A) to build your own toroidal field; its field is computed from where you put it.",
  category: "Magnets",
  role: "magnet-coil",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("ringRadiusM", "Ring radius R", 3, 0.2, 15),
    dim("windingRadiusM", "Winding radius", 0.25, 0.02, 2),
    dim("wallM", "Case thickness", 0.06, 0.005, 0.5),
  ],
  shape: (d) => {
    const R = d["ringRadiusM"]!;
    const a = Math.min(d["windingRadiusM"]!, 0.5 * R);
    const t = Math.min(d["wallM"]!, 0.9 * a);
    return {
      geometry: torusGeometry(R, a, "z", t),
      sockets: [
        structural("foot", vec3(0, -(R + a), 0), DOWN),
        socket("power", "electrical", vec3(0, R + a, 0), UP),
        socket("coolant-in", "coolant", vec3(R + a, 0.15, 0), PX),
        socket("coolant-out", "coolant", vec3(R + a, -0.15, 0), PX),
        socket("sensor", "control", vec3(-(R + a), 0, 0), NX),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "torus"
      ? {
          ringRadiusM: g.majorRadiusM,
          windingRadiusM: g.minorRadiusM,
          wallM: g.wallThicknessM ?? 0.06,
        }
      : {},
  presets: {
    winding: "loop",
    turns: 100,
    currentA: 50000,
    superconducting: true,
    conductor: "nb3sn",
    cryoCapacityW: 3e3,
  },
  keyProperty: "5 MA-turns · SC",
});

/**
 * Poloidal-Field Coil — a horizontal superconducting ring (NbTi, as in ITER's PF coils).
 * Rings above and below the plasma shape and hold it in a real machine; ForgeLab's 0D
 * plasma does not compute equilibrium, so its field is computed (Biot–Savart) and shown,
 * and the model says it does not use it.
 */
export const PF_COIL = define({
  type: "pf-coil",
  name: "Poloidal-Field Coil",
  description:
    "Horizontal NbTi ring coil in a steel jacket, 8 m ring radius by default (ITER's six PF coils span 8–24 m across). Shapes and positions the plasma in a real machine: ForgeLab computes its field but its 0D plasma does not model equilibrium.",
  category: "Magnets",
  role: "magnet-coil",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("ringRadiusM", "Ring radius R", 8, 1, 15),
    dim("windingRadiusM", "Winding radius", 0.5, 0.1, 2),
    dim("wallM", "Jacket thickness", 0.1, 0.01, 0.5),
  ],
  shape: (d) => {
    const R = d["ringRadiusM"]!;
    const a = Math.min(d["windingRadiusM"]!, 0.5 * R);
    const t = Math.min(d["wallM"]!, 0.9 * a);
    return {
      geometry: torusGeometry(R, a, "y", t),
      sockets: [
        structural("bracket-px", vec3(R, -a, 0), DOWN),
        structural("bracket-nx", vec3(-R, -a, 0), DOWN),
        socket("power", "electrical", vec3(R + a, 0, 0), PX),
        socket("sensor", "control", vec3(-(R + a), 0, 0), NX),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "torus"
      ? {
          ringRadiusM: g.majorRadiusM,
          windingRadiusM: g.minorRadiusM,
          wallM: g.wallThicknessM ?? 0.1,
        }
      : {},
  presets: {
    winding: "loop",
    turns: 200,
    currentA: 45000,
    superconducting: true,
    conductor: "nbti",
    cryoCapacityW: 5e3,
  },
  keyProperty: "9 MA-turns · NbTi",
});

/**
 * Central Solenoid — the superconducting stack in a tokamak's bore (ITER: Nb₃Sn, about
 * 4 m across and 13 m tall). ForgeLab assumes the plasma current is driven (the vessel's
 * plasma-current setting) and does not model the solenoid's flux swing; its field, peak
 * field, stored energy and hoop stress are computed like any solenoid's.
 */
export const CENTRAL_SOLENOID = define({
  type: "central-solenoid",
  name: "Central Solenoid",
  description:
    "Nb₃Sn solenoid stack for a tokamak's central bore, 1.6 m radius and 12 m tall by default, 3000 turns at 40 kA (~12.6 T). The plasma current it would drive is taken as given; its own field, stress and quench are computed.",
  category: "Magnets",
  role: "magnet-coil",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("radiusM", "Radius", 1.6, 0.3, 6),
    dim("lengthM", "Height", 12, 1, 30),
    dim("wallM", "Winding thickness", 0.7, 0.05, 2),
  ],
  shape: (d) => {
    const r = d["radiusM"]!;
    const L = d["lengthM"]!;
    const t = Math.min(d["wallM"]!, r / 2);
    return {
      geometry: cylinderGeometry(r, L, "y", t),
      sockets: [
        structural("base", vec3(0, -L / 2, 0), DOWN),
        socket("power", "electrical", vec3(r, L / 2 - 0.5, 0), PX),
        socket("sensor", "control", vec3(-r, L / 2 - 0.5, 0), NX),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder"
      ? { radiusM: g.radiusM, lengthM: g.heightM, wallM: g.wallThicknessM ?? 0.7 }
      : {},
  presets: {
    turns: 3000,
    currentA: 40000,
    superconducting: true,
    conductor: "nb3sn",
    cryoCapacityW: 1e4,
  },
  keyProperty: "120 MA-turns · Nb₃Sn",
});

/**
 * Solenoid Coil — a short copper solenoid (default r = 2.2 m, 0.8 m long) for linear
 * devices. Resistive by default: it dissipates I²R and needs water cooling.
 */
export const SOLENOID_COIL = define({
  type: "solenoid-coil",
  name: "Solenoid Coil",
  description:
    "Copper solenoid, 2.2 m radius and 0.8 m long by default, 200 turns. Place coaxially around a cylindrical chamber. Resistive by default — cool it.",
  category: "Magnets",
  role: "magnet-coil",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("radiusM", "Radius", 2.2, 0.3, 12),
    dim("lengthM", "Length", 0.8, 0.1, 20),
    dim("wallM", "Winding thickness", 0.25, 0.02, 2),
  ],
  shape: (d) => {
    const r = d["radiusM"]!;
    const L = d["lengthM"]!;
    const t = Math.min(d["wallM"]!, r / 2);
    return {
      geometry: cylinderGeometry(r, L, "y", t),
      sockets: [
        structural("base", vec3(r - t / 2, -L / 2, 0), DOWN),
        socket("power", "electrical", vec3(r, 0, 0), PX),
        socket("coolant-in", "coolant", vec3(0, L / 4, r), PZ),
        socket("coolant-out", "coolant", vec3(0, -L / 4, r), PZ),
        socket("sensor", "control", vec3(-r, L / 2, 0), UP),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder"
      ? { radiusM: g.radiusM, lengthM: g.heightM, wallM: g.wallThicknessM ?? 0.25 }
      : {},
  presets: {
    turns: 200,
    currentA: 10000,
    superconducting: false,
    conductorAreaM2: 1e-3,
    coolantConductanceWK: 2e5,
    channelDiameterM: 0.1,
    channelLengthM: 20,
  },
  keyProperty: "200 turns · Cu",
});

/* ------------------------------------------------------------------------------------ *
 * Fuel, heating, vacuum
 * ------------------------------------------------------------------------------------ */

export const FUEL_INJECTOR = define({
  type: "fuel-injector",
  name: "Fuel Injector",
  description:
    "Pellet and gas fuelling for a 50:50 D–T mix with a density feedback controller. Link its fuel port to a vessel.",
  category: "Fuel",
  role: "fuel-injector",
  material: MaterialIds.StainlessSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(1.6, 1.4, 1.2)),
    sockets: [
      base(1.4),
      socket("fuel", "fuel", vec3(0.8, 0, 0), PX),
      socket("power", "electrical", vec3(-0.8, 0, 0), NX),
      socket("control", "control", vec3(0, 0.7, 0), UP),
    ],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "1.0e20 m⁻³ target",
});

export const NEUTRAL_BEAM = define({
  type: "neutral-beam",
  name: "Neutral Beam Heater",
  description:
    "Neutral-beam injector delivering 50 MW into the plasma at 35 % wall-plug efficiency (143 MW drawn). Link its port to a vessel.",
  category: "Fuel",
  role: "plasma-heater",
  material: MaterialIds.StainlessSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(5, 2.4, 2.4), 0.03),
    sockets: [
      base(2.4),
      socket("port", "port", vec3(2.5, 0, 0), PX),
      socket("power", "electrical", vec3(-2.5, 0, 0), NX),
      socket("control", "control", vec3(0, 1.2, 0), UP),
    ],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "50 MW heating",
});

export const VACUUM_PUMP = define({
  type: "vacuum-pump",
  name: "Cryopump Bank",
  description: "80 m³/s of pumping speed at the vessel. Link its vacuum port to a vessel.",
  category: "Vacuum",
  role: "vacuum-pump",
  material: MaterialIds.StainlessSteel,
  dimensions: [],
  shape: () => ({
    geometry: cylinderGeometry(0.8, 2, "y", 0.02),
    sockets: [
      base(2),
      socket("vacuum", "vacuum", vec3(0, 1, 0), UP),
      socket("power", "electrical", vec3(0.8, 0, 0), PX),
      socket("control", "control", vec3(-0.8, 0, 0), NX),
    ],
  }),
  dimensionsOf: () => ({}),
  presets: { pumpingSpeedM3PerS: 80 },
  keyProperty: "80 m³/s",
});

/* ------------------------------------------------------------------------------------ *
 * Electrical
 * ------------------------------------------------------------------------------------ */

export const GRID_CONNECTION = define({
  type: "grid-connection",
  name: "Grid Connection",
  description:
    "Regulated 20 kV DC supply from the grid, up to 1 GW. Imports whatever the plant cannot generate itself — and imported power counts against net output.",
  category: "Electrical",
  role: "power-supply",
  material: MaterialIds.StructuralSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(2.4, 2.4, 2), 0.01),
    sockets: [base(2.4), socket("power", "electrical", vec3(1.2, 0, 0), PX)],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "20 kV · 1 GW",
});

export const BUS_BAR = define({
  type: "bus-bar",
  name: "Bus Bar",
  description:
    "Copper bus bar, 4 m long by default. Resistance R = ρL/A from its length and the conductor cross-section parameter. Undersize it and it overheats.",
  category: "Electrical",
  role: "conductor",
  material: MaterialIds.Copper,
  dimensions: [dim("lengthM", "Length", 4, 0.5, 100)],
  shape: (d) => {
    const L = d["lengthM"]!;
    return {
      geometry: boxGeometry(vec3(L, 0.1, 0.3)),
      sockets: [
        socket("a", "electrical", vec3(-L / 2, 0, 0), NX),
        socket("b", "electrical", vec3(L / 2, 0, 0), PX),
        socket("sensor", "control", vec3(0, 0.05, 0), UP),
        structural("bottom", vec3(0, -0.05, 0), DOWN),
      ],
    };
  },
  dimensionsOf: (g) => (g.kind === "box" ? { lengthM: g.sizeM.x } : {}),
  keyProperty: "2000 mm² Cu",
});

export const BREAKER = define({
  type: "breaker",
  name: "Circuit Breaker",
  description: "Opens or closes an electrical path. Interlocks can open it automatically.",
  category: "Electrical",
  role: "switch",
  material: MaterialIds.StructuralSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(1, 1.6, 0.8), 0.005),
    sockets: [
      base(1.6),
      socket("line", "electrical", vec3(-0.5, 0, 0), NX),
      socket("load", "electrical", vec3(0.5, 0, 0), PX),
      socket("control", "control", vec3(0, 0.8, 0), UP),
    ],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "Closed",
});

/* ------------------------------------------------------------------------------------ *
 * Thermal and fluids
 * ------------------------------------------------------------------------------------ */

const BLANKET = define({
  type: "breeding-blanket",
  name: "Breeding Blanket",
  description:
    "Water-cooled blanket and shield torus around the vessel (1.15 m thick by default). Captures neutron energy (×1.18 multiplication) and shields the coils.",
  category: "Thermal",
  role: "blanket",
  material: MaterialIds.StainlessSteel,
  dimensions: [
    dim("majorRadiusM", "Major radius R", 6.2, 1, 15),
    dim("tubeRadiusM", "Tube radius", 3.5, 0.4, 8),
    dim("wallM", "Thickness", 1.15, 0.05, 3),
  ],
  shape: (d) => {
    const { R, a, geometry } = torusShape(d);
    const t = geometry.kind === "torus" ? (geometry.wallThicknessM ?? 0) : 0;
    return {
      geometry,
      sockets: [
        ...torusSupports(R, a, t),
        socket("coolant-in", "coolant", vec3(0, 0.6, R + a), PZ),
        socket("coolant-out", "coolant", vec3(0, -0.6, R + a), PZ),
        socket("sensor", "control", vec3(-R, a, 0), UP),
      ],
    };
  },
  dimensionsOf: torusDims,
  presets: { coolantConductanceWK: 50e6, channelDiameterM: 1, channelLengthM: 30 },
  keyProperty: "1.15 m · ×1.18",
});
export const BREEDING_BLANKET = BLANKET;

export const COOLANT_PIPE = define({
  type: "coolant-pipe",
  name: "Coolant Pipe",
  description:
    "Steel pipe, 4 m long with a 660 mm bore and a 60 mm wall by default. Friction loss follows Darcy–Weisbach; it holds coolant inventory, and its wall must hold the loop pressure (Lamé hoop stress against the steel's yield at temperature).",
  category: "Fluids",
  role: "coolant-pipe",
  material: MaterialIds.StructuralSteel,
  dimensions: [
    dim("lengthM", "Length", 4, 0.5, 50),
    dim("outerRadiusM", "Outer radius", 0.39, 0.02, 1.5),
    dim("wallM", "Wall thickness", 0.06, 0.002, 0.3),
  ],
  shape: (d) => {
    const L = d["lengthM"]!;
    const r = d["outerRadiusM"]!;
    const t = Math.min(d["wallM"]!, r / 3);
    return {
      geometry: cylinderGeometry(r, L, "x", t),
      sockets: [
        socket("a", "coolant", vec3(-L / 2, 0, 0), NX),
        socket("b", "coolant", vec3(L / 2, 0, 0), PX),
        structural("bottom", vec3(0, -r, 0), DOWN),
      ],
    };
  },
  dimensionsOf: (g) =>
    g.kind === "cylinder"
      ? { lengthM: g.heightM, outerRadiusM: g.radiusM, wallM: g.wallThicknessM ?? 0.06 }
      : {},
  keyProperty: "DN650 · 4 m",
});

export const COOLANT_PUMP = define({
  type: "coolant-pump",
  name: "Coolant Pump",
  description:
    "Centrifugal pump for pressurised water: 4000 kg/s at 120 m head (5.9 MW electrical). Every closed coolant loop needs one.",
  category: "Fluids",
  role: "coolant-pump",
  material: MaterialIds.StainlessSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(2, 2, 2), 0.04),
    sockets: [
      base(2),
      socket("inlet", "coolant", vec3(-1, 0, 0), NX),
      socket("outlet", "coolant", vec3(1, 0, 0), PX),
      socket("power", "electrical", vec3(0, 0, -1), NZ),
      socket("control", "control", vec3(0, 1, 0), UP),
    ],
  }),
  dimensionsOf: () => ({}),
  presets: { ratedMassFlowKgS: 4000, ratedHeadM: 120 },
  keyProperty: "4000 kg/s",
});

export const STEAM_GENERATOR = define({
  type: "steam-generator",
  name: "Steam Generator",
  description:
    "Heat exchanger from the primary coolant to boiling secondary water (UA 60 MW/K). Link its steam side to a turbine; without one, heat goes to a cooling tower.",
  category: "Thermal",
  role: "heat-exchanger",
  material: MaterialIds.StainlessSteel,
  dimensions: [],
  shape: () => ({
    geometry: cylinderGeometry(1.6, 8, "y", 0.08),
    sockets: [
      base(8),
      socket("primary-in", "coolant", vec3(1.6, 2, 0), PX),
      socket("primary-out", "coolant", vec3(1.6, -2, 0), PX),
      socket("steam", "steam", vec3(0, 4, 0), UP),
      socket("sensor", "control", vec3(-1.6, 0, 0), NX),
    ],
  }),
  dimensionsOf: () => ({}),
  presets: { secondaryConductanceWK: 60e6, channelDiameterM: 0.8, channelLengthM: 20 },
  keyProperty: "60 MW/K",
});

/* ------------------------------------------------------------------------------------ *
 * Power conversion
 * ------------------------------------------------------------------------------------ */

export const STEAM_TURBINE = define({
  type: "steam-turbine",
  name: "Steam Turbine",
  description:
    "Rankine-cycle turbine at 553 K live steam and 308 K condenser: 0.75 × Carnot ≈ 33 % efficiency. Shaft it to a generator.",
  category: "Power conversion",
  role: "turbine",
  material: MaterialIds.StructuralSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(10, 4, 4), 0.05),
    sockets: [
      base(4),
      socket("steam", "steam", vec3(-5, 0, 0), NX),
      socket("shaft", "shaft", vec3(5, 0, 0), PX),
    ],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "η ≈ 33 %",
});

export const GENERATOR = define({
  type: "generator",
  name: "Generator",
  description:
    "Synchronous generator, 98.5 % efficient, feeding a 20 kV DC bus. Shaft-coupled to a turbine.",
  category: "Power conversion",
  role: "generator",
  material: MaterialIds.StructuralSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(6, 4, 4), 0.05),
    sockets: [
      base(4),
      socket("shaft", "shaft", vec3(-3, 0, 0), NX),
      socket("power", "electrical", vec3(3, 0, 0), PX),
    ],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "η 98.5 %",
});

/* ------------------------------------------------------------------------------------ *
 * Sensors and controls
 * ------------------------------------------------------------------------------------ */

export const SENSOR = define({
  type: "sensor",
  name: "Sensor",
  description:
    "Reads temperature, coolant flow, pressure, fusion power or field from the component it is linked to, and reports it to controllers.",
  category: "Sensors",
  role: "sensor",
  material: MaterialIds.Aluminum,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(0.3, 0.3, 0.3)),
    sockets: [base(0.3), socket("signal", "control", vec3(0, 0.15, 0), UP)],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "Temperature",
});

export const INTERLOCK = define({
  type: "interlock",
  name: "Interlock Controller",
  description:
    "Trips when a linked sensor crosses its setpoint: shuts the plasma down in a controlled way, or opens linked breakers. Latches until reset.",
  category: "Controls",
  role: "controller",
  material: MaterialIds.StructuralSteel,
  dimensions: [],
  shape: () => ({
    geometry: boxGeometry(vec3(0.8, 1.8, 0.6), 0.003),
    sockets: [base(1.8), socket("signal", "control", vec3(0, 0.9, 0), UP)],
  }),
  dimensionsOf: () => ({}),
  keyProperty: "Trip at setpoint",
});

/** Catalogue in a fixed order. The component browser renders it as given. */
export const COMPONENT_DEFINITIONS: readonly ComponentDefinition[] = Object.freeze([
  STRUCTURAL_BEAM,
  STRUCTURAL_PLATFORM,
  REACTOR_CHAMBER,
  EQUIPMENT_BLOCK,
  STAIR_TOWER,
  TOKAMAK_VESSEL,
  CRYOSTAT,
  CHAMBER_STRAIGHT,
  CHAMBER_BEND,
  CHAMBER_END_CAP,
  TF_COIL_SET,
  CIRCULAR_COIL,
  PF_COIL,
  CENTRAL_SOLENOID,
  SOLENOID_COIL,
  FUEL_INJECTOR,
  NEUTRAL_BEAM,
  VACUUM_PUMP,
  GRID_CONNECTION,
  BUS_BAR,
  BREAKER,
  BREEDING_BLANKET,
  COOLANT_PIPE,
  COOLANT_PUMP,
  STEAM_GENERATOR,
  STEAM_TURBINE,
  GENERATOR,
  SENSOR,
  INTERLOCK,
]);

const BY_TYPE = new Map(COMPONENT_DEFINITIONS.map((definition) => [definition.type, definition]));

export function findComponentDefinition(type: string): ComponentDefinition | undefined {
  return BY_TYPE.get(type);
}

export function getComponentDefinition(type: string): ComponentDefinition {
  const definition = BY_TYPE.get(type);
  if (definition === undefined) {
    const known = COMPONENT_DEFINITIONS.map((d) => d.type).join(", ");
    throw new Error(`Unknown component type "${type}". Known types: ${known}.`);
  }
  return definition;
}
