import {
  AlertTriangle,
  Check,
  Cloud,
  CloudOff,
  Download,
  Eye,
  FilePlus2,
  FolderOpen,
  GitFork,
  History,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Redo2,
  Save,
  Send,
  Square,
  Trophy,
  Undo2,
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AccountMenu } from "../../components/AccountMenu.js";
import { LogoMark } from "../../components/Logo.js";
import { relativeTime } from "../../lib/format.js";
import { MOD } from "../../lib/platform.js";
import type { CommandContext } from "../commands.js";
import { useEditor, useEditorStore } from "../store/context.js";

function SaveStatus() {
  const save = useEditor((v) => v.save);
  const cloud = useEditor((v) => v.cloud);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const map = {
    local: {
      icon: <Check />,
      text: "Saved in this browser",
      tone: "dim",
      tip: "Autosaved locally. Sign in and Save to keep it in the cloud.",
    },
    saved: {
      icon: <Cloud />,
      text: save.lastSavedAt ? `Saved ${relativeTime(save.lastSavedAt)}` : "Saved",
      tone: "ok",
      tip: "All changes are in the cloud.",
    },
    saving: {
      icon: <Loader2 className="spin" />,
      text: "Saving…",
      tone: "dim",
      tip: "Uploading the latest version.",
    },
    unsaved: {
      icon: <Cloud />,
      text: "Unsaved changes",
      tone: "warn",
      tip: "Autosaving in a moment.",
    },
    offline: {
      icon: <CloudOff />,
      text: "Offline",
      tone: "warn",
      tip: "Changes are kept in this browser and upload when you reconnect.",
    },
    error: {
      icon: <AlertTriangle />,
      text: "Save failed — retrying",
      tone: "bad",
      tip: save.error ?? "The last save failed.",
    },
    readonly: {
      icon: <Eye />,
      text: `Viewing${cloud?.ownerUsername ? ` @${cloud.ownerUsername}'s design` : ""}`,
      tone: "dim",
      tip: "Fork this design to save your own changes.",
    },
  } as const;
  const s = map[save.status];
  return (
    <span
      className={`save-status save-status--${s.tone}`}
      data-tip={s.tip}
      role="status"
      aria-live="polite"
    >
      {s.icon}
      <span>{s.text}</span>
    </span>
  );
}

function MoreMenu({ context }: { context: CommandContext }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const item = (icon: React.ReactNode, label: string, run: () => void, hint?: string) => (
    <button
      type="button"
      role="menuitem"
      className="menu__item"
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {icon} {label}
      {hint && <span className="menu__hint">{hint}</span>}
    </button>
  );
  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="btn btn--ghost btn--icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal />
      </button>
      {open && (
        <div className="menu__list" role="menu">
          {item(<FilePlus2 />, "New project", context.newProject)}
          {item(<LayoutTemplate />, "Load a blueprint…", context.openBlueprints)}
          {item(<History />, "Version history…", () => context.store.openDialog("versions"))}
          {item(<Save />, "Create named version…", context.newVersion, `${MOD} ⇧ S`)}
          <div className="menu__sep" />
          {item(<Upload />, "Import .json…", context.importFile, `${MOD} O`)}
          {item(<Download />, "Export .json", context.exportFile, `${MOD} E`)}
          <div className="menu__sep" />
          {item(<Trophy />, "Submit score…", context.submitScore)}
          {item(<FolderOpen />, "My projects", () => window.location.assign("/projects"))}
        </div>
      )}
    </div>
  );
}

export function TopBar({ context }: { context: CommandContext }) {
  const store = useEditorStore();
  const name = useEditor((v) => v.name);
  const mode = useEditor((v) => v.mode);
  const canUndo = useEditor((v) => v.canUndo);
  const canRedo = useEditor((v) => v.canRedo);
  const undoLabel = useEditor((v) => v.undoLabel);
  const redoLabel = useEditor((v) => v.redoLabel);
  const cloud = useEditor((v) => v.cloud);
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  const building = mode === "build";
  return (
    <header className="topbar">
      <Link to="/" className="topbar__home" aria-label="ForgeLab home" data-tip="Home">
        <LogoMark size={22} />
      </Link>
      <div className="topbar__project">
        {editing ? (
          <input
            className="input topbar__name-input"
            value={draft}
            autoFocus
            maxLength={120}
            aria-label="Project name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== null) store.setName(draft);
              setDraft(null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setDraft(null);
            }}
          />
        ) : (
          <button
            type="button"
            className="topbar__name"
            onClick={() => setDraft(name)}
            data-tip="Rename"
          >
            {name}
          </button>
        )}
        <SaveStatus />
      </div>
      <div className="topbar__group">
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Undo"
          data-tip={undoLabel ? `Undo ${undoLabel} (${MOD} Z)` : "Undo"}
          disabled={!canUndo || !building}
          onClick={store.undo}
        >
          <Undo2 />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label="Redo"
          data-tip={redoLabel ? `Redo ${redoLabel}` : "Redo"}
          disabled={!canRedo || !building}
          onClick={store.redo}
        >
          <Redo2 />
        </button>
      </div>
      <div className="topbar__center">
        <div className="segmented segmented--mode" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={building}
            className={building ? "is-active" : ""}
            onClick={store.stopSimulation}
          >
            Build
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!building}
            className={!building ? "is-active" : ""}
            onClick={() => building && store.startSimulation()}
          >
            Simulate
          </button>
        </div>
        {building ? (
          <button
            type="button"
            className="btn btn--primary simulate-btn"
            onClick={() => store.startSimulation()}
            data-tip="Run the design (Tab)"
          >
            <Zap /> SIMULATE
          </button>
        ) : (
          <button
            type="button"
            className="btn simulate-btn"
            onClick={store.stopSimulation}
            data-tip="Stop and return to Build (Tab)"
          >
            <Square /> STOP
          </button>
        )}
      </div>
      <div className="topbar__end">
        {cloud?.readOnly ? (
          <button type="button" className="btn btn--sm" onClick={context.fork}>
            <GitFork /> Fork to edit
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--sm"
            onClick={context.save}
            data-tip={`Save to cloud (${MOD} S)`}
          >
            <Save /> Save
          </button>
        )}
        {!cloud?.readOnly && (
          <button type="button" className="btn btn--sm" onClick={context.publish}>
            <Send /> {cloud?.visibility === "public" ? "Published" : "Publish"}
          </button>
        )}
        <MoreMenu context={context} />
        <AccountMenu />
      </div>
    </header>
  );
}
