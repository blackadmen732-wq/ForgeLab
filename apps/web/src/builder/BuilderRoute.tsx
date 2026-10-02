import "./builder.css";
import { SIMULATION_ENGINE_VERSION, parseAssemblyFile, serializeWorld } from "@forgelab/sim-core";
import { designHash } from "@forgelab/sim-runner";
import { ROLE_PERMISSIONS, type ProjectRole } from "@forgelab/protocol";
import { MonitorX, Smartphone } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from "react-router";
import { CollabBanner } from "../collab/CollabBanner.js";
import { CollabContext } from "../collab/context.js";
import { CollabController } from "../collab/controller.js";
import { ManageDialog } from "../collab/ManageDialog.js";
import { TeamPanel } from "../collab/TeamPanel.js";
import { VoiceBar } from "../collab/VoiceBar.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { Loading } from "../components/States.js";
import {
  createProject,
  forkProject,
  getProfileById,
  getProject,
  getVersion,
  saveVersion,
  slugify,
  type Project,
} from "../lib/api.js";
import { useAuth } from "../lib/auth.js";
import { getMyRole } from "../lib/collab.js";
import { confirmDialog } from "../lib/confirm.js";
import { env } from "../lib/env.js";
import { detectWebGL, isTypingTarget } from "../lib/platform.js";
import { errorMessage, toast } from "../lib/toast.js";
import { COMMANDS, type CommandContext } from "./commands.js";
import { Viewport } from "./scene/Viewport.js";
import { SHOWROOM_SCENARIOS, buildScenario } from "@forgelab/reactor-components";
import { AudioEngine } from "../presentation/audio/engine.js";
import { FailureCinema } from "../presentation/cinema.js";
import { vfxDebug } from "../presentation/vfx/runtime.js";
import {
  AudioEngineContext,
  CinemaContext,
  PresentationContext,
  usePresentation,
} from "../presentation/context.js";
import { PresentationDirector } from "../presentation/director.js";
import { setCinematic, useCinematic } from "../presentation/view.js";
import { EditorContext, useEditor, useEditorStore, useSim } from "./store/context.js";
import { EditorStore } from "./store/editor.js";
import { type CloudBinding, readLocalDraft } from "./store/persistence.js";
import { CommandPalette } from "./ui/CommandPalette.js";
import { ComponentDrawer } from "./ui/ComponentDrawer.js";
import { HelpOverlay } from "./ui/HelpOverlay.js";
import { Hints } from "./ui/Hints.js";
import { ActivationHud } from "./ui/ActivationHud.js";
import { FailureCinemaPanel } from "./ui/FailureCinema.js";
import { RunReportPanel } from "./ui/RunReport.js";
import { MaterialLab } from "./ui/MaterialLab.js";
import { InternalsNotice } from "./ui/InternalsNotice.js";
import { EffectsDebugPanel } from "./ui/EffectsDebugPanel.js";
import { Inspector } from "./ui/Inspector.js";
import { PatternDialog } from "./ui/PatternDialog.js";
import { PreflightDialog } from "./ui/PreflightDialog.js";
import { PublishDialog } from "./ui/PublishDialog.js";
import { StartDialog } from "./ui/StartDialog.js";
import { SubmitDialog } from "./ui/SubmitDialog.js";
import { Timeline } from "./ui/Timeline.js";
import { CameraModeHint, ToolRail } from "./ui/ToolRail.js";
import { PlantTree } from "./ui/PlantTree.js";
import { InspectPanel } from "./ui/InspectPanel.js";
import { TopBar } from "./ui/TopBar.js";
import { VersionNameDialog, VersionsDialog } from "./ui/VersionsDialog.js";
import { useHover } from "./scene/hover.js";

type PendingAction = "save" | "publish" | "submit" | "fork" | "version" | null;

function bindingFor(
  project: Project,
  role: ProjectRole | null,
  ownerUsername: string | null,
): CloudBinding {
  return {
    projectId: project.id,
    ownerId: project.owner_id,
    ownerUsername,
    name: project.name,
    description: project.description,
    visibility: project.visibility,
    thumbnailPath: project.thumbnail_path,
    latestVersionId: project.latest_version_id,
    role,
    readOnly: !canEdit(role),
  };
}

const canEdit = (role: ProjectRole | null) =>
  role !== null && ROLE_PERMISSIONS[role].includes("can_edit_design");

function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------------------------ *
 * Workspace layout
 * ------------------------------------------------------------------------------------ */

function StatusStrip() {
  const target = useHover();
  const mode = useEditor((v) => v.mode);
  const tool = useEditor((v) => v.tool);
  const connectFrom = useEditor((v) => v.connectFrom);
  const components = useEditor((v) => v.snapshot.components);
  const label = target
    ? (components.find((c) => c.id === target.componentId)?.label ?? target.componentId)
    : null;
  let text: string;
  if (tool === "connect")
    text =
      connectFrom === null
        ? "Connect: click a socket, then a matching socket on another part."
        : `Connect from ${connectFrom.componentId} · ${connectFrom.connectionPointId} — now click the other end (Esc cancels).`;
  else if (tool === "box") text = "Box select: drag a rectangle. Shift adds to the selection.";
  else if (mode === "simulate")
    text = "Simulating. Click a part for live values; click a failure to fly to it.";
  else
    text =
      "Drag to orbit · right-drag to pan · wheel to zoom · Shift-drag to box-select · Ctrl K for commands · ? for shortcuts";
  return (
    <div className="status-strip" aria-live="off">
      <span>{text}</span>
      {label !== null && (
        <span className="status-strip__hover">
          {label}
          {target?.socket && (
            <>
              {" "}
              · <span className="mono">{target.socket.label ?? target.socket.id}</span> (
              {target.socket.rating ?? target.socket.type})
            </>
          )}
        </span>
      )}
    </div>
  );
}

function ReadOnlyBanner({ onFork }: { onFork: () => void }) {
  const cloud = useEditor((v) => v.cloud);
  if (!cloud?.readOnly) return null;
  return (
    <div className="readonly-banner" role="status">
      You're viewing <strong>{cloud.name}</strong>
      {cloud.ownerUsername && <> by @{cloud.ownerUsername}</>}. Run it and experiment freely — fork
      it to save your changes.
      <button type="button" className="btn btn--sm btn--primary" onClick={onFork}>
        Fork
      </button>
    </div>
  );
}

function Workspace({
  context,
  onStart,
  onCreateVersion,
  teamOpen,
  onLoadLatest,
}: {
  context: CommandContext;
  onStart: (kind: string) => void;
  onCreateVersion: (label: string) => Promise<void>;
  teamOpen: boolean;
  onLoadLatest: (versionId: string | null) => void;
}) {
  const store = useEditorStore();
  const [manage, setManage] = useState(false);
  const showTeam = teamOpen && context.toggleTeam !== undefined;
  const drawerOpen = useEditor((v) => v.drawerOpen);
  const treeOpen = useEditor((v) => v.treeOpen);
  const mode = useEditor((v) => v.mode);
  const hasSelection = useEditor((v) => v.selection.length > 0);
  const dialog = useEditor((v) => v.dialog);
  const showHelp = useEditor((v) => v.showHelp);
  const showPalette = useEditor((v) => v.showPalette);
  const building = mode === "build";
  const failureCount = useSim((s) => s.failures.length);
  const cinematic = useCinematic();
  const replaying = usePresentation((s) => s.replaying);
  const [debugPanel] = useState(() => new URLSearchParams(window.location.search).has("debug"));
  useEffect(() => {
    if (!cinematic) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setCinematic(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [cinematic]);

  // Telemetry stays hidden until asked for — except when something fails, which is the
  // moment a player needs it.
  const seenFailures = useRef(0);
  useEffect(() => {
    if (!building && failureCount > 0 && seenFailures.current === 0) store.toggleTimeline(true);
    seenFailures.current = building ? 0 : failureCount;
  }, [building, failureCount, store]);

  return (
    <div
      className={`builder builder--${mode}${cinematic ? " builder--cinematic" : ""}${replaying ? " builder--replay" : ""}`}
    >
      <TopBar context={context} />
      <div className={`builder__main${building ? "" : " builder__main--full"}`}>
        {building && <ToolRail />}
        <main id="main" className="builder__stage">
          <ErrorBoundary
            fallback={(error, reset) => (
              <div className="viewport__lost" role="alert">
                The 3D view crashed: {error.message}
                <button type="button" className="btn btn--sm" onClick={reset}>
                  Restart view
                </button>
              </div>
            )}
          >
            <Viewport />
          </ErrorBoundary>
          <div className="stage-notices">
            <ReadOnlyBanner onFork={context.fork} />
            <CollabBanner
              onLoadLatest={onLoadLatest}
              onKeepMine={() => void store.cloud.keepMine()}
            />
          </div>
          <VoiceBar />
          {showTeam ? (
            <div className="panel panel--left">
              <TeamPanel
                onClose={() => context.toggleTeam?.()}
                onManage={() => setManage(true)}
                onFocusComponent={(id) => store.focusComponent(id)}
                componentExists={(id) => store.world.getComponent(id) !== undefined}
              />
            </div>
          ) : treeOpen ? (
            <div className="panel panel--left">
              <PlantTree />
            </div>
          ) : (
            drawerOpen &&
            building && (
              <div className="panel panel--left">
                <ComponentDrawer />
              </div>
            )
          )}
          {hasSelection && (
            <div className="panel panel--right">
              <Inspector />
            </div>
          )}
          <ActivationHud />
          <FailureCinemaPanel />
          <RunReportPanel />
          <MaterialLab />
          <InternalsNotice />
          {debugPanel && <EffectsDebugPanel />}
          <Hints />
          <CameraModeHint />
          <InspectPanel />
          <StatusStrip />
          <Timeline />
        </main>
      </div>
      {dialog === "start" && <StartDialog onStart={onStart} />}
      {dialog === "publish" && <PublishDialog />}
      {dialog === "submit" && <SubmitDialog />}
      {dialog === "versions" && <VersionsDialog onNewVersion={context.newVersion} />}
      {dialog === "version-name" && <VersionNameDialog onCreate={onCreateVersion} />}
      {dialog === "preflight" && <PreflightDialog />}
      {dialog === "pattern" && <PatternDialog />}
      {showHelp && <HelpOverlay />}
      {showPalette && <CommandPalette context={context} />}
      {manage && <ManageDialog onClose={() => setManage(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ *
 * Route
 * ------------------------------------------------------------------------------------ */

export function BuilderRoute() {
  const { projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const [store] = useState(() => new EditorStore());
  // Presentation (lighting, sound, effects) observes the store; it never writes to it.
  const [director] = useState(() => new PresentationDirector(store));
  const [audio] = useState(() => new AudioEngine(director));
  const [cinema] = useState(() => new FailureCinema(director, store));
  useEffect(() => {
    // Browsers only allow sound after a gesture: start on the first one.
    const start = () => audio.start();
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      audio.dispose();
    };
  }, [audio]);
  useEffect(() => {
    director.start();
    // Browser tests read presentation state through this handle (`/app?debug`). It exposes
    // nothing a player cannot already do in their own tab.
    const debug = new URLSearchParams(window.location.search).has("debug");
    if (debug)
      (window as unknown as { __forgelab?: unknown }).__forgelab = {
        store,
        director,
        audio,
        cinema,
        vfxStats: () => vfxDebug.runtime?.stats() ?? {},
        vfx: () => vfxDebug.runtime,
        scenarios: SHOWROOM_SCENARIOS.map((s) => s.id),
        loadScenario: (id: string) => {
          store.loadFile(serializeWorld(buildScenario(id)));
          store.requestFrame(null);
        },
      };
    return () => director.stop();
  }, [director, store, audio, cinema]);
  const [webgl] = useState(() => detectWebGL());
  const [narrowOk, setNarrowOk] = useState(() => window.innerWidth >= 820);
  const [busy, setBusy] = useState<string | null>(null);
  /** Outcome of loading a cloud project, keyed by the id it was for. */
  const [cloudLoad, setCloudLoad] = useState<{ projectId: string; error: string | null } | null>(
    null,
  );
  const pending = useRef<PendingAction>(null);
  const initialised = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const userId = auth.user?.id ?? null;
  /** Which account the current cloud binding's access was worked out for. */
  const boundUser = useRef<string | null | undefined>(undefined);
  const [teamOpen, setTeamOpen] = useState(() => params.get("team") === "1");
  const binding = useSyncExternalStore(store.subscribe, () => store.getView().cloud);
  const mode = useSyncExternalStore(store.subscribe, () => store.getView().mode);

  useEffect(() => {
    store.activate();
    return () => store.suspend();
  }, [store]);

  useEffect(() => {
    document.title = "Builder — ForgeLab";
    return () => {
      document.title = "ForgeLab — Build anything. Physics decides.";
    };
  }, []);

  /* ---------------- loading ---------------- */

  useEffect(() => {
    if (projectId !== undefined) return;
    // /app: a fresh workspace, the local draft, or the start dialog.
    const wantsNew = params.get("new") === "1";
    const wantsDraft = params.get("draft") === "1";
    if (initialised.current && !wantsNew) return;
    initialised.current = true;
    if (wantsNew) {
      store.newBlank();
      store.cloud.bind(null);
      store.openDialog("start");
      setParams({}, { replace: true });
      return;
    }
    if (store.cloud.binding !== null) return;
    const draft = readLocalDraft();
    if (draft !== null && draft.projectId !== null && !wantsDraft && env.cloudConfigured) {
      void navigate(`/app/${draft.projectId}`, { replace: true });
      return;
    }
    if (draft !== null && draft.file.components.length > 0) {
      try {
        store.loadFile(draft.file);
        if (!wantsDraft)
          toast("info", "Restored your last design", "It was autosaved in this browser.", 3000);
      } catch {
        store.openDialog("start");
      }
      if (wantsDraft) setParams({}, { replace: true });
      return;
    }
    store.openDialog("start");
  }, [projectId, params, setParams, store, navigate]);

  useEffect(() => {
    if (projectId === undefined) return;
    if (!env.cloudConfigured || auth.status === "loading") return;
    const bound = store.cloud.binding;
    if (bound?.projectId === projectId && boundUser.current === userId) return;
    let live = true;
    initialised.current = true;
    const roleFor = () =>
      userId === null ? Promise.resolve(null) : getMyRole(projectId).catch(() => null);

    if (bound?.projectId === projectId) {
      // Same design, different account (signed in or out while viewing): only access changes.
      void roleFor().then((role) => {
        if (!live) return;
        boundUser.current = userId;
        store.cloud.bind({ ...bound, role, readOnly: !canEdit(role) });
      });
      return () => {
        live = false;
      };
    }

    void (async () => {
      try {
        const [project, role] = await Promise.all([getProject(projectId), roleFor()]);
        if (!live) return;
        if (project === null) throw new Error("This project doesn't exist, or it's private.");
        if (project.latest_version_id === null)
          throw new Error("This project has no saved version yet.");
        const [version, owner] = await Promise.all([
          getVersion(project.latest_version_id),
          getProfileById(project.owner_id),
        ]);
        if (!live) return;
        if (version === null) throw new Error("The latest version could not be read.");
        let design = version.design;
        const draft = readLocalDraft();
        if (
          canEdit(role) &&
          draft !== null &&
          draft.projectId === project.id &&
          new Date(draft.savedAt) > new Date(version.created_at)
        ) {
          const draftHash = designHash(parseAssemblyFile(draft.file));
          if (draftHash !== version.design_hash) {
            const restore = await confirmDialog({
              title: "Recover unsaved changes?",
              body: "This browser has changes to this project that never reached the cloud (you were offline or closed the tab mid-save).",
              confirmLabel: "Recover them",
              cancelLabel: "Use the cloud version",
            });
            if (restore) design = draft.file;
          }
        }
        // The project row owns the name (renames can outlive the last physics change).
        store.loadFile(design, { name: project.name });
        boundUser.current = userId;
        store.cloud.bind(bindingFor(project, role, owner?.username ?? null), {
          hash: version.design_hash,
          name: project.name,
        });
        if (design !== version.design) store.cloud.markChanged();
        store.openDialog(null);
        store.requestFrame(null);
        setCloudLoad({ projectId, error: null });
      } catch (error) {
        if (live) setCloudLoad({ projectId, error: errorMessage(error) });
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId, auth.status, userId, store]);

  /* ---------------- team: presence, channels, chat, voice ---------------- */

  // Members of the open project get a live team connection; it ends when they leave it.
  const collabKey =
    binding !== null && binding.role !== null && userId !== null
      ? `${binding.projectId}|${userId}`
      : null;
  const collab = useMemo(() => {
    if (collabKey === null) return null;
    const [project, user] = collabKey.split("|") as [string, string];
    return new CollabController(project, user);
  }, [collabKey]);
  useEffect(() => {
    if (collab === null) return;
    void collab.start();
    const unsubscribe = store.cloud.onSaved((version) => collab.announceRevision(version));
    // Role changes made by an admin while this project is open take effect here too.
    const unwatch = collab.subscribe(() => {
      const { role, loading } = collab.getState();
      const bound = store.cloud.binding;
      if (loading || bound === null || bound.role === role) return;
      if (role === null) toast("warning", "You no longer have access to this project");
      store.cloud.setAccess(role, !canEdit(role));
    });
    return () => {
      unwatch();
      unsubscribe();
      void collab.stop();
    };
  }, [collab, store]);

  useEffect(() => {
    collab?.setActivity(
      mode === "simulate" ? "simulating" : binding?.readOnly ? "observing" : "building",
    );
  }, [collab, mode, binding?.readOnly]);

  /** Replaces the editor's design with the project's latest (or a given) saved version. */
  const loadLatest = useCallback(
    async (versionId: string | null) => {
      const bound = store.cloud.binding;
      if (bound === null) return;
      if (store.cloud.hasUnsavedChanges || store.cloud.state.status === "conflict") {
        const ok = await confirmDialog({
          title: "Load the teammate's version?",
          body: "Your changes since your last save will be discarded. To keep them instead, choose Keep mine — their version stays in the history either way.",
          confirmLabel: "Load theirs",
          danger: true,
        });
        if (!ok) return;
      }
      setBusy("Loading the latest version");
      try {
        const project = await getProject(bound.projectId);
        const id = versionId ?? project?.latest_version_id ?? null;
        const version = id === null ? null : await getVersion(id);
        if (project === null || version === null) throw new Error("That version can't be read.");
        store.loadFile(version.design, { name: project.name });
        store.cloud.adoptVersion(version, project.name);
        collab?.dismissRevision();
      } catch (error) {
        toast("error", "Couldn't load the version", errorMessage(error));
      } finally {
        setBusy(null);
      }
    },
    [store, collab],
  );

  /* ---------------- cloud actions ---------------- */

  const requireAccount = useCallback(
    (action: PendingAction, reason: string): boolean => {
      if (!env.cloudConfigured) {
        toast(
          "info",
          "Cloud features aren't configured",
          "Designs are saved in this browser. Export a .json file to keep a copy.",
        );
        return false;
      }
      if (auth.status === "signed-in") return true;
      pending.current = action;
      auth.openAuth("sign-in", reason);
      return false;
    },
    [auth],
  );

  const createCloudProject = useCallback(async (): Promise<boolean> => {
    const file = store.exportFile();
    setBusy("Creating cloud project");
    try {
      const { project, version } = await createProject(
        file.name,
        {
          design: file,
          designHash: designHash(file),
          engineVersion: SIMULATION_ENGINE_VERSION,
          autosave: false,
          label: "Created",
        },
        store.projectStats(),
      );
      store.cloud.bind(
        bindingFor(
          { ...project, latest_version_id: version.id },
          "owner",
          auth.profile?.username ?? null,
        ),
        { hash: version.design_hash, name: file.name },
      );
      boundUser.current = userId;
      store.flushDraft();
      void navigate(`/app/${project.id}`, { replace: true });
      toast("success", "Saved to the cloud", "Changes now autosave while you work.");
      return true;
    } catch (error) {
      toast("error", "Couldn't save to the cloud", errorMessage(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [store, userId, auth.profile, navigate]);

  const save = useCallback(async () => {
    if (!env.cloudConfigured) {
      store.flushDraft();
      toast(
        "success",
        "Saved in this browser",
        "Cloud saving isn't configured on this deployment.",
      );
      return;
    }
    if (
      !requireAccount(
        "save",
        "Sign in to save this design to the cloud. It stays autosaved in this browser meanwhile.",
      )
    )
      return;
    const binding = store.cloud.binding;
    if (binding === null) {
      await createCloudProject();
      return;
    }
    if (binding.readOnly) {
      toast("info", "This design belongs to someone else", "Fork it to save your own copy.");
      return;
    }
    await store.cloud.flush();
    if (store.cloud.state.status === "saved") toast("success", "Saved", undefined, 1500);
  }, [store, requireAccount, createCloudProject]);

  const fork = useCallback(async () => {
    const binding = store.cloud.binding;
    if (binding === null) return;
    if (!requireAccount("fork", "Sign in to fork this design into your own projects.")) return;
    setBusy("Forking");
    try {
      const id = await forkProject(binding.projectId);
      // Keep whatever was changed while viewing: it becomes the fork's first own version.
      const file = store.exportFile();
      const hash = designHash(file);
      const source = binding.latestVersionId ? await getVersion(binding.latestVersionId) : null;
      if (source !== null && source.design_hash !== hash) {
        const forked = await getProject(id);
        await saveVersion(id, {
          parentVersionId: forked?.latest_version_id ?? null,
          design: file,
          designHash: hash,
          engineVersion: SIMULATION_ENGINE_VERSION,
          autosave: false,
          label: "Changes made before forking",
        });
      }
      store.cloud.bind(null);
      toast("success", "Forked", "This copy is yours and private until you publish it.");
      void navigate(`/app/${id}`);
    } catch (error) {
      toast("error", "Couldn't fork", errorMessage(error));
    } finally {
      setBusy(null);
    }
  }, [store, requireAccount, navigate]);

  const withProject = useCallback(
    async (action: Exclude<PendingAction, null>, reason: string, then: () => void) => {
      if (!requireAccount(action, reason)) return;
      if (store.cloud.binding === null && !(await createCloudProject())) return;
      if (store.cloud.binding?.readOnly) {
        toast("info", "Fork this design first", "Only the owner can publish or submit it.");
        return;
      }
      if (action === "publish" && store.cloud.binding?.role !== "owner") {
        toast("info", "Only the owner can publish", "Ask the project owner to publish it.");
        return;
      }
      then();
    },
    [store, requireAccount, createCloudProject],
  );

  const context = useMemo<CommandContext>(
    () => ({
      store,
      save: () => void save(),
      fork: () => void fork(),
      newVersion: () =>
        void withProject("version", "Sign in to keep named versions.", () =>
          store.openDialog("version-name"),
        ),
      publish: () =>
        void withProject("publish", "Sign in to publish your design.", () =>
          store.openDialog("publish"),
        ),
      submitScore: () => store.openDialog("submit"),
      importFile: () => fileInput.current?.click(),
      exportFile: () => {
        download(`${slugify(store.world.name)}.forgelab.json`, store.exportJson());
        toast("success", "Exported", "A plain JSON design file anyone can import.");
      },
      newProject: () => {
        store.flushDraft();
        store.cloud.bind(null);
        void navigate("/app?new=1");
      },
      openBlueprints: () => store.openDialog("start"),
      ...(collab === null ? {} : { toggleTeam: () => setTeamOpen((open) => !open) }),
    }),
    [store, save, fork, withProject, navigate, collab],
  );

  // Finish what the player was doing when they were asked to sign in.
  useEffect(() => {
    if (auth.status !== "signed-in" || pending.current === null) return;
    const action = pending.current;
    pending.current = null;
    if (action === "save") context.save();
    else if (action === "fork") context.fork();
    else if (action === "publish") context.publish();
    else if (action === "version") context.newVersion();
    else if (action === "submit") context.submitScore();
  }, [auth.status, context]);

  const createVersion = useCallback(
    async (label: string) => {
      try {
        const v = await store.cloud.createVersion(label);
        if (v !== null) toast("success", `Version ${v.version_number} saved`, label);
      } catch (error) {
        toast("error", "Couldn't create the version", errorMessage(error));
      }
    },
    [store],
  );

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      if (isTypingTarget(event.target)) return;
      const active = document.activeElement;
      const onControl = active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement;
      if (onControl && (event.key === " " || event.key === "Enter" || event.key === "Tab")) return;
      if (
        event.key === "Tab" &&
        active !== document.body &&
        !(active instanceof HTMLCanvasElement) &&
        (active?.closest(".viewport") ?? null) === null
      )
        return;
      const view = store.getView();
      for (const command of COMMANDS) {
        if (command.match?.(event)) {
          event.preventDefault();
          if (command.enabled === undefined || command.enabled(view)) command.run(context);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, context]);

  /* ---------------- unsaved-change protection ---------------- */

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname &&
      !nextLocation.pathname.startsWith("/app") &&
      store.cloud.hasUnsavedChanges,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void (async () => {
      await store.cloud.flush();
      if (!store.cloud.hasUnsavedChanges) {
        blocker.proceed();
        return;
      }
      const leave = await confirmDialog({
        title: "Leave with unsaved changes?",
        body: "The latest changes haven't reached the cloud yet. They stay in this browser's autosave and can be recovered when you reopen the project.",
        confirmLabel: "Leave anyway",
        cancelLabel: "Stay",
        danger: true,
      });
      if (leave) blocker.proceed();
      else blocker.reset();
    })();
  }, [blocker, store]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      store.flushDraft();
      if (store.cloud.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hide = () => store.flushDraft();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", hide);
    };
  }, [store]);

  /* ---------------- render ---------------- */

  const loadError =
    projectId === undefined
      ? null
      : !env.cloudConfigured
        ? "Cloud projects aren't available on this deployment."
        : cloudLoad?.projectId === projectId
          ? cloudLoad.error
          : null;
  const loadingProject =
    projectId !== undefined &&
    env.cloudConfigured &&
    loadError === null &&
    cloudLoad?.projectId !== projectId &&
    store.cloud.binding?.projectId !== projectId;
  const loading = busy ?? (loadingProject ? "Loading project" : null);

  if (!webgl) {
    return (
      <main className="crash">
        <div className="crash__card">
          <MonitorX aria-hidden="true" />
          <h1>This browser can't run the 3D workspace</h1>
          <p className="dim">
            ForgeLab needs WebGL. It may be disabled in your browser settings, blocked by a policy,
            or unavailable on this device's graphics driver. Try an up-to-date Chrome, Edge, Firefox
            or Safari with hardware acceleration enabled.
          </p>
          <div className="row">
            <Link className="btn" to="/discover">
              Browse designs instead
            </Link>
            <a
              className="btn btn--ghost"
              href="https://get.webgl.org/"
              target="_blank"
              rel="noreferrer"
            >
              Check WebGL support
            </a>
          </div>
        </div>
      </main>
    );
  }

  if (!narrowOk) {
    return (
      <main className="crash">
        <div className="crash__card">
          <Smartphone aria-hidden="true" />
          <h1>The builder needs a bigger screen</h1>
          <p className="dim">
            ForgeLab's editor is designed for a desktop or laptop with a mouse. You can still browse
            and run published designs.
          </p>
          <div className="row">
            <Link className="btn btn--primary" to="/discover">
              Explore designs
            </Link>
            <button type="button" className="btn btn--ghost" onClick={() => setNarrowOk(true)}>
              Open anyway
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loadError !== null) {
    return (
      <main className="crash">
        <div className="crash__card">
          <p className="eyebrow">Couldn't open this project</p>
          <h1>{loadError}</h1>
          <div className="row">
            {auth.status === "guest" && (
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => auth.openAuth("sign-in", "Sign in to open your private projects.")}
              >
                Sign in
              </button>
            )}
            <Link className="btn" to="/app?new=1">
              New project
            </Link>
            <Link className="btn btn--ghost" to="/projects">
              My projects
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <EditorContext.Provider value={store}>
      <PresentationContext.Provider value={director}>
        <AudioEngineContext.Provider value={audio}>
          <CinemaContext.Provider value={cinema}>
            <CollabContext.Provider value={collab}>
              <Workspace
                context={context}
                teamOpen={teamOpen}
                onLoadLatest={(versionId) => void loadLatest(versionId)}
                onStart={(kind) => {
                  store.cloud.bind(null);
                  if (projectId !== undefined) void navigate("/app", { replace: true });
                  if (kind !== "blank") store.requestFrame(null);
                }}
                onCreateVersion={createVersion}
              />
            </CollabContext.Provider>
          </CinemaContext.Provider>
        </AudioEngineContext.Provider>
      </PresentationContext.Provider>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > 5_000_000) {
            toast("error", "That file is too large", "Design files are limited to 5 MB.");
            return;
          }
          try {
            const parsed: unknown = JSON.parse(await file.text());
            if (store.getView().snapshot.components.length > 0) {
              const ok = await confirmDialog({
                title: "Replace the current design?",
                body: "Undo won't bring it back; export it first if you want to keep it.",
                confirmLabel: "Replace",
              });
              if (!ok) return;
            }
            store.loadFile(parsed);
            store.cloud.bind(null);
            if (projectId !== undefined) void navigate("/app", { replace: true });
            store.requestFrame(null);
            toast("success", "Imported", file.name);
          } catch (error) {
            toast("error", "Couldn't import that file", errorMessage(error));
          }
        }}
      />
      {loading !== null && (
        <div className="builder-loading">
          <Loading label={loading} />
        </div>
      )}
    </EditorContext.Provider>
  );
}
