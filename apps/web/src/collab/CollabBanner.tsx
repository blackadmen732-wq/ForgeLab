import { AlertTriangle, History } from "lucide-react";
import { useEditor } from "../builder/store/context.js";
import { useCollab, useCollabController } from "./context.js";

/**
 * Shared-save notices. A conflict means autosave is paused because a teammate saved
 * first; a revision notice means a teammate saved a version this editor isn't showing.
 * Neither ever changes the design without the user choosing to.
 */
export function CollabBanner({
  onLoadLatest,
  onKeepMine,
}: {
  onLoadLatest: (versionId: string | null) => void;
  onKeepMine: () => void;
}) {
  const controller = useCollabController();
  const save = useEditor((v) => v.save);
  const cloud = useEditor((v) => v.cloud);
  const revision = useCollab((s) => s.revision) ?? null;

  if (save.status === "conflict") {
    return (
      <div className="readonly-banner collab-banner collab-banner--conflict" role="alert">
        <AlertTriangle aria-hidden="true" />
        <span>
          A teammate saved a newer version while you were editing. Autosave is paused so nobody's
          work is overwritten.
        </span>
        <button type="button" className="btn btn--sm" onClick={() => onLoadLatest(null)}>
          Load theirs
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={onKeepMine}>
          Keep mine
        </button>
      </div>
    );
  }
  if (revision === null || cloud === null || revision.versionId === cloud.latestVersionId)
    return null;
  return (
    <div className="readonly-banner collab-banner" role="status">
      <History aria-hidden="true" />
      <span>
        <strong>{revision.fromName}</strong> saved version {revision.versionNumber}
        {revision.label ? ` — ${revision.label}` : ""}.
      </span>
      <button
        type="button"
        className="btn btn--sm btn--primary"
        onClick={() => onLoadLatest(revision.versionId)}
      >
        Load it
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={() => controller?.dismissRevision()}
      >
        Dismiss
      </button>
    </div>
  );
}
