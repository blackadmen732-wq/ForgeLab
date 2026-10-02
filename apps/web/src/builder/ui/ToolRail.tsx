import {
  BoxSelect,
  Cable,
  Eye,
  EyeOff,
  Focus,
  Footprints,
  Grid3x3,
  ListTree,
  HelpCircle,
  Layers,
  Layers2,
  Magnet,
  MousePointer2,
  PanelLeft,
  PersonStanding,
  RotateCw,
  Scan,
  Scissors,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEditor, useEditorStore } from "../store/context.js";
import type { Tool } from "../store/editor.js";

function RailButton({
  label,
  keys,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rail__btn${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      data-tip={keys ? `${label} (${keys})` : label}
      data-tip-side="right"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ToolRail() {
  const store = useEditorStore();
  const tool = useEditor((v) => v.tool);
  const mode = useEditor((v) => v.mode);
  const drawerOpen = useEditor((v) => v.drawerOpen);
  const snap = useEditor((v) => v.snapEnabled);
  const cutaway = useEditor((v) => v.cutaway);
  const xray = useEditor((v) => v.xray);
  const hiddenCount = useEditor((v) => v.hidden.size);
  const cameraMode = useEditor((v) => v.cameraMode);
  const showScale = useEditor((v) => v.showScale);
  const treeOpen = useEditor((v) => v.treeOpen);
  const inspectOpen = useEditor((v) => v.inspectOpen);
  const inspecting = useEditor((v) => v.section !== null || v.peel > 0 || v.explode > 0);
  const hasSelection = useEditor((v) => v.selection.length > 0);
  const building = mode === "build";
  const tools: { id: Tool; label: string; keys: string; icon: ReactNode; buildOnly: boolean }[] = [
    { id: "select", label: "Select & move", keys: "V", icon: <MousePointer2 />, buildOnly: false },
    { id: "rotate", label: "Rotate", keys: "E", icon: <RotateCw />, buildOnly: true },
    { id: "connect", label: "Connect sockets", keys: "C", icon: <Cable />, buildOnly: true },
    { id: "box", label: "Box select", keys: "B", icon: <BoxSelect />, buildOnly: false },
  ];
  return (
    <nav className="rail" aria-label="Tools">
      <RailButton
        label="Parts drawer"
        keys="A"
        active={drawerOpen}
        onClick={() => store.toggleDrawer()}
      >
        <PanelLeft />
      </RailButton>
      <div className="rail__sep" />
      {tools.map((t) => (
        <RailButton
          key={t.id}
          label={t.label}
          keys={t.keys}
          active={tool === t.id}
          disabled={t.buildOnly && !building}
          onClick={() => store.setTool(t.id)}
        >
          {t.icon}
        </RailButton>
      ))}
      <div className="rail__sep" />
      <RailButton
        label={snap ? "Snapping on (hold Alt to override)" : "Snapping off"}
        keys="N"
        active={snap}
        onClick={() => store.setSnapEnabled(!snap)}
      >
        {snap ? <Magnet /> : <Grid3x3 />}
      </RailButton>
      <RailButton label="Frame selection" keys="F" onClick={store.frameSelection}>
        <Focus />
      </RailButton>
      <RailButton
        label={hiddenCount > 0 ? `Show all (${hiddenCount} hidden)` : "Hide selection"}
        keys={hiddenCount > 0 ? "Alt H" : "H"}
        active={hiddenCount > 0}
        disabled={hiddenCount === 0 && !hasSelection}
        onClick={hiddenCount > 0 ? store.showAll : store.hideSelected}
      >
        {hiddenCount > 0 ? <Eye /> : <EyeOff />}
      </RailButton>
      <RailButton
        label="Isolate selection"
        keys="I"
        active={hiddenCount > 0}
        disabled={hiddenCount === 0 && !hasSelection}
        onClick={store.toggleIsolate}
      >
        <Layers />
      </RailButton>
      <RailButton label="Cutaway" keys="X" active={cutaway} onClick={() => store.toggleCutaway()}>
        <Scissors />
      </RailButton>
      <RailButton label="X-ray" keys="Z" active={xray} onClick={store.toggleXray}>
        <Scan />
      </RailButton>
      <RailButton label="Plant tree" keys="O" active={treeOpen} onClick={() => store.toggleTree()}>
        <ListTree />
      </RailButton>
      <RailButton
        label="Inspection views"
        keys="L"
        active={inspectOpen || inspecting}
        onClick={() => store.toggleInspect()}
      >
        <Layers2 />
      </RailButton>
      <RailButton
        label={cameraMode === "orbit" ? "Walk at eye height" : "Back to orbit"}
        keys={cameraMode === "orbit" ? "G" : "Esc"}
        active={cameraMode !== "orbit"}
        onClick={() => store.setCameraMode(cameraMode === "orbit" ? "walk" : "orbit")}
      >
        <Footprints />
      </RailButton>
      <RailButton
        label="Scale reference (1.75 m person)"
        keys="U"
        active={showScale}
        onClick={store.toggleScale}
      >
        <PersonStanding />
      </RailButton>
      <div className="rail__spacer" />
      <RailButton label="Keyboard shortcuts" keys="?" onClick={() => store.setShowHelp(true)}>
        <HelpCircle />
      </RailButton>
    </nav>
  );
}

/** While walking or flying: how to move, and how to get back. */
export function CameraModeHint() {
  const cameraMode = useEditor((v) => v.cameraMode);
  if (cameraMode === "orbit") return null;
  return (
    <div className="walk-hint" role="status">
      <strong>{cameraMode === "walk" ? "Walking · eye height 1.7 m" : "Flying"}</strong>
      <span>
        W A S D move{cameraMode === "fly" ? " · Q / E down, up" : ""} · drag to look · Shift faster
        · Esc orbit
      </span>
    </div>
  );
}
