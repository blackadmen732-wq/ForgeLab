import { useLayoutEffect, useMemo } from "react";
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  MeshStandardMaterial,
  TorusGeometry,
} from "three";
import { findComponentDefinition, type ProductInternal } from "@forgelab/reactor-components";
import type { ComponentGeometry, SimulationComponent } from "@forgelab/sim-core";
import { useEditor } from "../store/context.js";
import { useThree } from "@react-three/fiber";
import { CUT_PLANE, PALETTE, materialColor } from "./appearance.js";
import { useRegionHighlight } from "./regionHighlight.js";

/**
 * The inside of the selected part, in cutaway: its internal regions from the product
 * sheet as nested bands, outermost first, coloured by substance (the Inspector's "Inside"
 * list uses the same colours).
 *
 * Where a sheet gives volume fractions the bands are sized by them; otherwise they are
 * drawn in equal steps and the view says so — region order is known, proportions are not,
 * and none are invented.
 */
export function layerScales(internals: readonly ProductInternal[]): number[] {
  const n = internals.length;
  const known = internals.every((i) => typeof i.volumeFraction === "number");
  if (known) {
    const total = internals.reduce((s, i) => s + (i.volumeFraction ?? 0), 0) || 1;
    let cumulative = 0;
    return internals.map((i) => {
      const scale = Math.cbrt(Math.max(0.02, 1 - cumulative / total));
      cumulative += i.volumeFraction ?? 0;
      return scale;
    });
  }
  return internals.map((_, k) => 1 - (0.8 * k) / n);
}

function layer(geometry: ComponentGeometry, scale: number): BufferGeometry {
  switch (geometry.kind) {
    case "box":
      return new BoxGeometry(
        geometry.sizeM.x * scale,
        geometry.sizeM.y * scale,
        geometry.sizeM.z * scale,
      );
    case "cylinder": {
      const g = new CylinderGeometry(
        geometry.radiusM * scale,
        geometry.radiusM * scale,
        geometry.heightM * (0.5 + 0.5 * scale),
        40,
      );
      if (geometry.axis === "x") g.rotateZ(Math.PI / 2);
      if (geometry.axis === "z") g.rotateX(Math.PI / 2);
      return g;
    }
    case "torus": {
      const g = new TorusGeometry(geometry.majorRadiusM, geometry.minorRadiusM * scale, 24, 96);
      if (geometry.axis === "y") g.rotateX(Math.PI / 2);
      if (geometry.axis === "x") g.rotateY(Math.PI / 2);
      return g;
    }
  }
}

/** Lights the picked region's band and fades the others (null: all as normal). */
function showPicked(
  layers: readonly { key: string; material: MeshStandardMaterial }[],
  picked: string | null,
): void {
  for (const l of layers) {
    const lit = picked === l.key;
    const faded = picked !== null && !lit;
    l.material.emissive.set(lit ? PALETTE.select : 0x000000);
    l.material.emissiveIntensity = lit ? 0.55 : 0;
    if (l.material.transparent !== faded) {
      l.material.transparent = faded;
      l.material.depthWrite = !faded;
      l.material.needsUpdate = true;
    }
    l.material.opacity = faded ? 0.18 : 1;
  }
}

function Section({ component }: { component: SimulationComponent }) {
  const internals = useMemo(
    () => findComponentDefinition(component.type)?.product.internals ?? [],
    [component.type],
  );
  const layers = useMemo(() => {
    if (internals.length < 2) return [];
    const scales = layerScales(internals);
    return internals.map((internal, k) => ({
      key: internal.id,
      geometry: layer(component.geometry, scales[k]! * 0.995),
      material: new MeshStandardMaterial({
        color: materialColor(internal.substanceId),
        roughness: 0.7,
        metalness: 0.2,
        side: DoubleSide,
        clippingPlanes: [CUT_PLANE],
        polygonOffset: true,
        polygonOffsetFactor: k,
      }),
    }));
  }, [internals, component.geometry]);
  useLayoutEffect(
    () => () => {
      for (const l of layers) {
        l.geometry.dispose();
        l.material.dispose();
      }
    },
    [layers],
  );
  // A region picked in the Inspector is lit; the others fade so it can be found.
  const highlight = useRegionHighlight();
  const invalidate = useThree((st) => st.invalidate);
  useLayoutEffect(() => {
    showPicked(layers, highlight?.componentId === component.id ? highlight.regionId : null);
    invalidate();
  }, [highlight, layers, component.id, invalidate]);
  const { positionM: p, rotation: q } = component.state.physical;
  return (
    <group position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
      {layers.map((l) => (
        <mesh key={l.key} geometry={l.geometry} material={l.material} renderOrder={1} />
      ))}
    </group>
  );
}

export function InternalsSection() {
  const cutaway = useEditor((v) => v.cutaway);
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  if (!cutaway) return null;
  return (
    <>
      {components
        .filter((c) => selection.includes(c.id))
        .map((c) => (
          <Section key={c.id} component={c} />
        ))}
    </>
  );
}
