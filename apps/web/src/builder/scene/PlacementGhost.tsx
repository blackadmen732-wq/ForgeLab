import { useMemo, useLayoutEffect } from "react";
import { getComponentDefinition } from "@forgelab/reactor-components";
import { useEditor } from "../store/context.js";
import { machineModel } from "./machines.js";

export function PlacementGhost() {
  const preview = useEditor((v) => v.placement);
  if (!preview) return null;
  return <ModuleGhost type={preview.type} />;
}
function ModuleGhost({ type }: { type: string }) {
  const preview = useEditor((v) => v.placement)!;
  const { model, spec } = useMemo(() => {
    const s = getComponentDefinition(type).createSpec({ id: "preview" });
    return { model: machineModel(type, s.geometry, s.connectionPoints ?? []), spec: s };
  }, [type]);
  useLayoutEffect(
    () => () => {
      for (const g of [model?.main, model?.trim, model?.accent]) g?.dispose();
    },
    [model],
  );
  // Colour is declarative; mutable Three state does not live in a memo value.
  const joint = spec.connectionPoints?.find((p) => p.id === preview.mate?.movingSocketId);
  const p = preview.transform.positionM,
    q = preview.transform.rotation;
  return (
    <group name="placement-preview" position={[p.x, p.y, p.z]} quaternion={[q.x, q.y, q.z, q.w]}>
      {[model?.main, model?.trim, model?.accent].map((g, i) =>
        g ? (
          <mesh key={i} geometry={g} raycast={() => {}}>
            <meshStandardMaterial
              color={preview.mate ? "#81e0ad" : "#9ecbff"}
              transparent
              opacity={0.42}
              depthWrite={false}
              metalness={0.1}
              roughness={0.45}
            />
          </mesh>
        ) : null,
      )}
      {preview.mate && (
        <mesh
          name="snap-joint-preview"
          position={
            joint
              ? [joint.localPosition.x, joint.localPosition.y, joint.localPosition.z]
              : [0, 0, 0]
          }
          raycast={() => {}}
        >
          <sphereGeometry args={[0.055, 12, 8]} />
          <meshBasicMaterial color="#81e0ad" depthTest={false} />
        </mesh>
      )}
    </group>
  );
}
