import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useEditor, useEditorStore } from "../store/context.js";
import { explodeOffsets } from "./inspection.js";
import { meshRegistry } from "./meshes.js";

/** The factor last applied to the drawing (−1 forces a re-apply). One viewport per page. */
const applied = { factor: -1 };

/**
 * Exploded view: moves each part's drawing away from the machine's centre by the explode
 * factor, and puts it back exactly at zero. The design never moves; only the drawing does.
 */
export function ExplodeDriver() {
  const store = useEditorStore();
  const explode = useEditor((v) => v.explode);
  const components = useEditor((v) => v.snapshot.components);
  const invalidate = useThree((s) => s.invalidate);
  const offsets = useMemo(() => explodeOffsets(components), [components]);
  useEffect(() => {
    applied.factor = -1;
    invalidate();
  }, [explode, offsets, invalidate]);

  useFrame(() => {
    const factor = store.getView().explode;
    if (factor === applied.factor) return;
    for (const c of store.getView().snapshot.components) {
      const handle = meshRegistry.get(c.id);
      if (handle === undefined) continue;
      const p = c.state.physical.positionM;
      const o = offsets.get(c.id);
      handle.group.position.set(
        p.x + (o?.x ?? 0) * factor,
        p.y + (o?.y ?? 0) * factor,
        p.z + (o?.z ?? 0) * factor,
      );
    }
    applied.factor = factor;
  });
  return null;
}
