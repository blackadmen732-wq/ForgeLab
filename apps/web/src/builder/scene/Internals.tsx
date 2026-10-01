import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import { Color, DoubleSide, MeshStandardMaterial } from "three";
import { findFluid } from "@forgelab/materials";
import {
  findComponentDefinition,
  type ProductInternal,
  type RegionKind,
} from "@forgelab/reactor-components";
import type { SimulationComponent } from "@forgelab/sim-core";
import type { Overlay } from "../store/editor.js";
import { useEditor, useEditorStore } from "../store/context.js";
import {
  PALETTE,
  appearanceFor,
  materialColor,
  readoutFromComponent,
  readoutFromFrame,
  type Readout,
} from "./appearance.js";
import { cutPlaneFor } from "./cutPlanes.js";
import { hasBespokeInternals, internalModel } from "./internalModels.js";
import { regionHighlight, useRegionHighlight } from "./regionHighlight.js";

export { layerScales } from "./internalModels.js";

/**
 * The inside of finished machines (see internalModels.ts — schematic). Shown:
 *  - in Cutaway, for the selected parts, cut by the same plane as their casings;
 *  - in the Internal Systems view, for every machine, cut the same way, casings ghosted.
 *
 * Colours: Normal shows each region's own material (fluids translucent); Internal
 * Systems colours regions by system; a physics view lights only the regions its quantity
 * physically lives in (current in conductors, flow in coolant, neutron heating in
 * plasma-facing and breeder regions) from the part's published value. The lumped model
 * has one value per part: the view does not invent a distribution inside it.
 */

/** Internal Systems colours: three validated hues, the rest carried by lightness. */
export type SystemGroup =
  "structure" | "conductors" | "insulation" | "fluids" | "vacuum" | "moving" | "instruments";

export const SYSTEM_OF: Readonly<Record<RegionKind, SystemGroup>> = {
  structure: "structure",
  "plasma-facing": "structure",
  conductor: "conductors",
  superconductor: "conductors",
  "magnetic-core": "conductors",
  insulation: "insulation",
  coolant: "fluids",
  cryogen: "fluids",
  fuel: "fluids",
  breeder: "fluids",
  vacuum: "vacuum",
  moving: "moving",
  sensor: "instruments",
  electronics: "instruments",
};

export const SYSTEMS: readonly { id: SystemGroup; label: string; color: string }[] = [
  { id: "fluids", label: "Coolant, cryogen, fuel and breeder", color: "#3987e5" },
  { id: "conductors", label: "Conductors and magnetic cores", color: "#d95926" },
  { id: "moving", label: "Moving machinery", color: "#199e70" },
  { id: "structure", label: "Structure and armour", color: "#7d8691" },
  { id: "insulation", label: "Insulation", color: "#d6c9a4" },
  { id: "instruments", label: "Sensors and electronics", color: "#eef1f4" },
  { id: "vacuum", label: "Vacuum and plasma volume", color: "#9aa3ad" },
];
const SYSTEM_COLOR = new Map(SYSTEMS.map((s) => [s.id, new Color(s.color)]));

/** Which region kinds each physics view lights. */
const LIT_BY: Readonly<Partial<Record<Overlay, readonly RegionKind[]>>> = {
  stress: ["structure", "plasma-facing", "moving"],
  power: ["conductor", "superconductor", "magnetic-core"],
  coolant: ["coolant", "cryogen"],
  magnetic: ["conductor", "superconductor", "magnetic-core"],
  vacuum: ["vacuum"],
  plasma: ["vacuum"],
  neutron: ["plasma-facing", "breeder", "structure", "superconductor", "coolant"],
};

const FLUID_KINDS = new Set<RegionKind>(["coolant", "cryogen", "fuel", "breeder", "vacuum"]);

interface RegionMesh {
  readonly id: string;
  readonly kind: RegionKind;
  readonly base: Color;
  readonly fluid: boolean;
  readonly material: MeshStandardMaterial;
}

function baseColor(internal: ProductInternal): Color {
  if (internal.substanceId === null) return SYSTEM_COLOR.get(SYSTEM_OF[internal.kind])!.clone();
  if (findFluid(internal.substanceId) !== undefined)
    return internal.kind === "vacuum" ? new Color("#f0c6e0") : new Color("#4aa3e8");
  return materialColor(internal.substanceId);
}

/** Paints one region for the current view. Pure apart from writing into `m`. */
export function paintRegion(
  overlay: Overlay,
  region: Pick<RegionMesh, "kind" | "base" | "fluid">,
  readout: Readout,
  picked: boolean | null,
  m: MeshStandardMaterial,
): void {
  let opacity = region.fluid ? (region.kind === "vacuum" ? 0.12 : 0.35) : 1;
  let emissive = 0;
  m.emissive.setRGB(0, 0, 0);
  if (overlay === "internals") {
    m.color.copy(SYSTEM_COLOR.get(SYSTEM_OF[region.kind])!);
    if (region.fluid && region.kind !== "vacuum") opacity = 0.6;
  } else if (overlay === "none") {
    m.color.copy(region.base);
  } else if (overlay === "temperature" || overlay === "failures") {
    emissive = appearanceFor(overlay, readout, region.base, m);
  } else if (LIT_BY[overlay]?.includes(region.kind) === true) {
    emissive = appearanceFor(overlay, readout, region.base, m);
    if (region.fluid) opacity = Math.max(opacity, 0.55);
  } else {
    m.color.copy(PALETTE.dim);
    opacity = Math.min(opacity, 0.25);
  }
  if (picked === true) {
    m.emissive.copy(PALETTE.select);
    emissive = 0.55;
    opacity = Math.max(opacity, 0.85);
  } else if (picked === false) opacity = Math.min(opacity, 0.15);
  m.emissiveIntensity = emissive;
  const transparent = opacity < 0.999;
  if (m.transparent !== transparent) {
    m.transparent = transparent;
    m.depthWrite = !transparent;
    m.needsUpdate = true;
  }
  m.opacity = opacity;
}

/** Live regions by component, painted each changed frame by the driver below. */
class RegionRegistry {
  /** Frame last painted. */
  lastFrame: unknown = null;
  readonly byComponent = new Map<string, readonly RegionMesh[]>();
  dirty = true;
  set(id: string, regions: readonly RegionMesh[]): void {
    this.byComponent.set(id, regions);
    this.dirty = true;
  }
  delete(id: string): void {
    this.byComponent.delete(id);
    this.dirty = true;
  }
}

/** One viewport, one registry. */
const registry = new RegionRegistry();

function Section({ component }: { component: SimulationComponent }) {
  const internals = useMemo(
    () => findComponentDefinition(component.type)?.product.internals ?? [],
    [component.type],
  );
  const meshes = useMemo(() => {
    const model = internalModel(component.type, component.geometry, internals);
    return internals.flatMap((internal, k) => {
      const geometry = model.get(internal.id);
      if (geometry === undefined) return [];
      const fluid =
        FLUID_KINDS.has(internal.kind) &&
        (internal.substanceId === null || findFluid(internal.substanceId) !== undefined);
      const region: RegionMesh = {
        id: internal.id,
        kind: internal.kind,
        base: baseColor(internal),
        fluid,
        material: new MeshStandardMaterial({
          roughness: fluid ? 0.2 : 0.6,
          metalness: fluid ? 0 : 0.25,
          side: DoubleSide,
          clippingPlanes: [cutPlaneFor(component.id)],
          polygonOffset: true,
          polygonOffsetFactor: k,
        }),
      };
      return [{ geometry, region }];
    });
  }, [component.type, component.geometry, component.id, internals]);

  useLayoutEffect(() => {
    registry.set(
      component.id,
      meshes.map((m) => m.region),
    );
    return () => {
      registry.delete(component.id);
      for (const m of meshes) {
        m.geometry.dispose();
        m.region.material.dispose();
      }
    };
  }, [meshes, component.id]);

  const { positionM: p, rotation: q } = component.state.physical;
  return (
    <group position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
      {meshes.map((m) => (
        <mesh
          key={m.region.id}
          geometry={m.geometry}
          material={m.region.material}
          renderOrder={m.region.fluid ? 2 : 1}
        />
      ))}
    </group>
  );
}

/** Whether a part has internals to show (a bespoke model, or at least two bands). */
export function showsInternals(type: string): boolean {
  const internals = findComponentDefinition(type)?.product.internals ?? [];
  return hasBespokeInternals(type) || internals.length >= 2;
}

export function InternalsSection() {
  const store = useEditorStore();
  const cutaway = useEditor((v) => v.cutaway);
  const overlay = useEditor((v) => v.overlay);
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const highlight = useRegionHighlight();
  const invalidate = useThree((s) => s.invalidate);

  const systems = overlay === "internals";
  const shown = components.filter(
    (c) => showsInternals(c.type) && (systems || (cutaway && selection.includes(c.id))),
  );

  useEffect(() => {
    registry.dirty = true;
    invalidate();
  }, [overlay, highlight, invalidate]);
  useEffect(() => {
    const mark = () => {
      registry.dirty = true;
      invalidate();
    };
    const a = store.subscribe(mark);
    const b = store.subscribeSim(mark);
    return () => {
      a();
      b();
    };
  }, [store, invalidate]);

  useFrame(() => {
    const frame = store.frame;
    if (!registry.dirty && frame === registry.lastFrame) return;
    registry.dirty = false;
    registry.lastFrame = frame;
    const view = store.getView();
    const live = view.mode === "simulate" && frame !== null;
    const picked = regionHighlight.get();
    for (const c of view.snapshot.components) {
      const regions = registry.byComponent.get(c.id);
      if (regions === undefined) continue;
      const index = live ? store.frameIndexOf(c.id) : undefined;
      const readout =
        live && index !== undefined ? readoutFromFrame(frame, index, c) : readoutFromComponent(c);
      const mine = picked?.componentId === c.id ? picked.regionId : null;
      for (const region of regions)
        paintRegion(
          view.overlay,
          region,
          readout,
          mine === null ? null : mine === region.id,
          region.material,
        );
    }
  });

  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((c) => (
        <Section key={c.id} component={c} />
      ))}
    </>
  );
}
