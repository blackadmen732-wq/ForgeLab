import { MOD } from "../lib/platform.js";
import { toggleCinematic, toggleFullscreen } from "../presentation/view.js";
import { HALL_CAMERAS, HALL_CAMERA_ORDER } from "./scene/environment/hall/cameras.js";
import type { EditorStore, EditorView } from "./store/editor.js";
import { materialLab } from "./ui/materialLab.js";

/**
 * Every builder action in one list. Keyboard shortcuts, the command palette and the
 * shortcut overlay are all generated from it, so they cannot disagree.
 */
export interface CommandContext {
  readonly store: EditorStore;
  save(): void;
  newVersion(): void;
  publish(): void;
  submitScore(): void;
  importFile(): void;
  exportFile(): void;
  newProject(): void;
  openBlueprints(): void;
  fork(): void;
  /** Shows or hides the team panel (channels, chat, voice); absent outside shared projects. */
  toggleTeam?: () => void;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: "File" | "Edit" | "Tools" | "View" | "Simulation" | "Help";
  /** Display form, e.g. "Ctrl Z". */
  readonly keys?: string;
  /** Matcher for keydown events. */
  readonly match?: (e: KeyboardEvent) => boolean;
  readonly enabled?: (view: EditorView) => boolean;
  run(context: CommandContext): void;
}

const mod = (e: KeyboardEvent) => e.ctrlKey || e.metaKey;
const plain = (e: KeyboardEvent) => !e.ctrlKey && !e.metaKey && !e.altKey;
const key = (k: string) => (e: KeyboardEvent) =>
  plain(e) && !e.shiftKey && e.key.toLowerCase() === k;
const building = (v: EditorView) => v.mode === "build";
const hasSelection = (v: EditorView) => v.selection.length > 0;
const editable = (v: EditorView) => v.mode === "build" && v.selection.length > 0;

export const COMMANDS: readonly Command[] = [
  // File
  {
    id: "save",
    label: "Save to cloud",
    group: "File",
    keys: `${MOD} S`,
    match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === "s",
    run: (c) => c.save(),
  },
  {
    id: "new-version",
    label: "Create named version…",
    group: "File",
    keys: `${MOD} Shift S`,
    match: (e) => mod(e) && e.shiftKey && e.key.toLowerCase() === "s",
    run: (c) => c.newVersion(),
  },
  { id: "publish", label: "Publish…", group: "File", run: (c) => c.publish() },
  {
    id: "submit",
    label: "Submit score for verification…",
    group: "File",
    run: (c) => c.submitScore(),
  },
  { id: "fork", label: "Fork this design", group: "File", run: (c) => c.fork() },
  {
    id: "versions",
    label: "Version history…",
    group: "File",
    run: (c) => c.store.openDialog("versions"),
  },
  { id: "new", label: "New project", group: "File", run: (c) => c.newProject() },
  { id: "blueprints", label: "Load a blueprint…", group: "File", run: (c) => c.openBlueprints() },
  {
    id: "team",
    label: "Team: channels, chat and voice",
    group: "View",
    enabled: (v) => (v.cloud?.role ?? null) !== null,
    run: (c) => c.toggleTeam?.(),
  },
  {
    id: "import",
    label: "Import design file (.json)…",
    group: "File",
    keys: `${MOD} O`,
    match: (e) => mod(e) && e.key.toLowerCase() === "o",
    run: (c) => c.importFile(),
  },
  {
    id: "export",
    label: "Export design file (.json)",
    group: "File",
    keys: `${MOD} E`,
    match: (e) => mod(e) && e.key.toLowerCase() === "e",
    run: (c) => c.exportFile(),
  },

  // Edit
  {
    id: "undo",
    label: "Undo",
    group: "Edit",
    keys: `${MOD} Z`,
    match: (e) => mod(e) && !e.shiftKey && e.key.toLowerCase() === "z",
    enabled: (v) => v.canUndo && building(v),
    run: (c) => c.store.undo(),
  },
  {
    id: "redo",
    label: "Redo",
    group: "Edit",
    keys: `${MOD} Shift Z`,
    match: (e) =>
      mod(e) && ((e.shiftKey && e.key.toLowerCase() === "z") || e.key.toLowerCase() === "y"),
    enabled: (v) => v.canRedo && building(v),
    run: (c) => c.store.redo(),
  },
  {
    id: "duplicate",
    label: "Duplicate selection",
    group: "Edit",
    keys: `${MOD} D`,
    match: (e) => mod(e) && e.key.toLowerCase() === "d",
    enabled: editable,
    run: (c) => c.store.duplicateSelected(),
  },
  {
    id: "pattern",
    label: "Pattern: radial array, linear array, mirror…",
    group: "Edit",
    keys: `${MOD} Shift A`,
    match: (e) => mod(e) && e.shiftKey && e.key.toLowerCase() === "a",
    enabled: editable,
    run: (c) => c.store.openDialog("pattern"),
  },
  {
    id: "delete",
    label: "Delete selection",
    group: "Edit",
    keys: "Del",
    match: (e) => plain(e) && (e.key === "Delete" || e.key === "Backspace"),
    enabled: editable,
    run: (c) => c.store.deleteSelected(),
  },
  {
    id: "select-all",
    label: "Select all",
    group: "Edit",
    keys: `${MOD} A`,
    match: (e) => mod(e) && e.key.toLowerCase() === "a",
    run: (c) => c.store.selectAll(),
  },
  {
    id: "deselect",
    label: "Clear selection / cancel",
    group: "Edit",
    keys: "Esc",
    match: (e) => e.key === "Escape",
    run: (c) => c.store.clearSelection(),
  },
  {
    id: "rotate-90",
    label: "Rotate selection 90°",
    group: "Edit",
    keys: "R",
    match: key("r"),
    enabled: editable,
    run: (c) => c.store.rotateSelection90(),
  },
  {
    id: "drop",
    label: "Drop selection to ground",
    group: "Edit",
    keys: "End",
    match: (e) => plain(e) && e.key === "End",
    enabled: editable,
    run: (c) => c.store.dropToGround(),
  },
  {
    id: "pin",
    label: "Pin / release selection",
    group: "Edit",
    keys: "P",
    match: key("p"),
    enabled: editable,
    run: (c) => {
      const v = c.store.getView();
      const anchored = v.selection.every((id) => c.store.world.getComponent(id)?.anchored);
      c.store.setAnchored(v.selection, !anchored);
    },
  },

  // Tools
  {
    id: "tool-select",
    label: "Select / move tool",
    group: "Tools",
    keys: "V",
    match: (e) => key("v")(e) || key("w")(e),
    run: (c) => c.store.setTool("select"),
  },
  {
    id: "tool-rotate",
    label: "Rotate tool",
    group: "Tools",
    keys: "E",
    match: key("e"),
    enabled: building,
    run: (c) => c.store.setTool("rotate"),
  },
  {
    id: "tool-connect",
    label: "Connect tool",
    group: "Tools",
    keys: "C",
    match: key("c"),
    enabled: building,
    run: (c) => c.store.setTool("connect"),
  },
  {
    id: "tool-box",
    label: "Box select (or Shift-drag)",
    group: "Tools",
    keys: "B",
    match: key("b"),
    run: (c) => c.store.setTool("box"),
  },
  {
    id: "snap",
    label: "Toggle snapping (hold Alt to override)",
    group: "Tools",
    keys: "N",
    match: key("n"),
    run: (c) => c.store.setSnapEnabled(!c.store.getView().snapEnabled),
  },
  {
    id: "drawer",
    label: "Toggle parts drawer",
    group: "Tools",
    keys: "A",
    match: key("a"),
    run: (c) => c.store.toggleDrawer(),
  },

  // View
  {
    id: "frame-selected",
    label: "Frame selection",
    group: "View",
    keys: "F",
    match: key("f"),
    run: (c) => c.store.frameSelection(),
  },
  {
    id: "frame-all",
    label: "Frame everything",
    group: "View",
    keys: "Shift F",
    match: (e) => plain(e) && e.shiftKey && e.key.toLowerCase() === "f",
    run: (c) => c.store.requestFrame(null),
  },
  {
    id: "view-front",
    label: "Front view",
    group: "View",
    keys: "1",
    match: key("1"),
    run: (c) => c.store.requestView("front"),
  },
  {
    id: "view-right",
    label: "Right view",
    group: "View",
    keys: "3",
    match: key("3"),
    run: (c) => c.store.requestView("right"),
  },
  {
    id: "view-top",
    label: "Top view",
    group: "View",
    keys: "7",
    match: key("7"),
    run: (c) => c.store.requestView("top"),
  },
  {
    id: "view-iso",
    label: "Isometric view",
    group: "View",
    keys: "0",
    match: key("0"),
    run: (c) => c.store.requestView("iso"),
  },
  ...HALL_CAMERA_ORDER.map((name, i): Command => ({
    id: `hall-camera-${name}`,
    label: `Hall camera: ${HALL_CAMERAS[name].label}`,
    group: "View",
    keys: `Shift ${i + 1}`,
    match: (e) => plain(e) && e.shiftKey && e.code === `Digit${i + 1}`,
    run: (c) => c.store.requestPose(HALL_CAMERAS[name].position, HALL_CAMERAS[name].target),
  })),
  {
    id: "cinematic",
    label: "Cinematic view (hide everything but the plant)",
    group: "View",
    keys: "K",
    match: key("k"),
    run: () => toggleCinematic(),
  },
  {
    id: "fullscreen",
    label: "Fullscreen",
    group: "View",
    keys: "Shift K",
    match: (e) => plain(e) && e.shiftKey && e.key.toLowerCase() === "k",
    run: () => toggleFullscreen(),
  },
  {
    id: "projection",
    label: "Perspective / orthographic",
    group: "View",
    keys: "5",
    match: key("5"),
    run: (c) => c.store.toggleProjection(),
  },
  {
    id: "hide",
    label: "Hide selection",
    group: "View",
    keys: "H",
    match: key("h"),
    enabled: hasSelection,
    run: (c) => c.store.hideSelected(),
  },
  {
    id: "unhide",
    label: "Show all",
    group: "View",
    keys: "Alt H",
    match: (e) => e.altKey && e.key.toLowerCase() === "h",
    run: (c) => c.store.showAll(),
  },
  {
    id: "isolate",
    label: "Isolate selection / exit isolate",
    group: "View",
    keys: "I",
    match: key("i"),
    run: (c) => c.store.toggleIsolate(),
  },
  {
    id: "material-lab",
    label: "Material Lab",
    group: "Tools",
    keys: "M",
    match: key("m"),
    run: () => materialLab.toggle(),
  },
  {
    id: "cutaway",
    label: "Cutaway",
    group: "View",
    keys: "X",
    match: key("x"),
    run: (c) => c.store.toggleCutaway(),
  },
  {
    id: "xray",
    label: "X-ray",
    group: "View",
    keys: "Z",
    match: key("z"),
    run: (c) => c.store.toggleXray(),
  },
  {
    id: "timeline",
    label: "Engineering overlay (telemetry, plant figures, failures)",
    group: "View",
    keys: "T",
    match: key("t"),
    run: (c) => c.store.toggleTimeline(),
  },

  // Simulation
  {
    id: "simulate",
    label: "Build ↔ Simulate",
    group: "Simulation",
    keys: "Tab",
    match: (e) => plain(e) && !e.shiftKey && e.key === "Tab",
    run: (c) => c.store.toggleSimulation(),
  },
  {
    id: "play",
    label: "Play / pause",
    group: "Simulation",
    keys: "Space",
    match: (e) => plain(e) && e.key === " ",
    run: (c) => c.store.togglePlay(),
  },
  {
    id: "step",
    label: "Step one tick",
    group: "Simulation",
    keys: ".",
    match: (e) => plain(e) && e.key === ".",
    enabled: (v) => v.mode === "simulate",
    run: (c) => c.store.stepSimulation(1),
  },
  {
    id: "reset",
    label: "Reset run",
    group: "Simulation",
    keys: "Shift R",
    match: (e) => plain(e) && e.shiftKey && e.key.toLowerCase() === "r",
    enabled: (v) => v.mode === "simulate",
    run: (c) => c.store.resetSimulation(),
  },
  { id: "speed-10", label: "Run at 10×", group: "Simulation", run: (c) => c.store.setSpeed(10) },
  {
    id: "speed-max",
    label: "Run flat out",
    group: "Simulation",
    run: (c) => c.store.setSpeed("max"),
  },

  // Help
  {
    id: "palette",
    label: "Command palette",
    group: "Help",
    keys: `${MOD} K`,
    match: (e) => mod(e) && e.key.toLowerCase() === "k",
    run: (c) => c.store.setShowPalette(true),
  },
  {
    id: "help",
    label: "Keyboard shortcuts",
    group: "Help",
    keys: "?",
    match: (e) => e.key === "?",
    run: (c) => c.store.setShowHelp(true),
  },
];
