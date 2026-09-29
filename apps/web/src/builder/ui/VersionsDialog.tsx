import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Dialog } from "../../components/Dialog.js";
import { Loading } from "../../components/States.js";
import { getVersion, listVersions } from "../../lib/api.js";
import { confirmDialog } from "../../lib/confirm.js";
import { relativeTime } from "../../lib/format.js";
import { errorMessage, toast } from "../../lib/toast.js";
import { useAsync } from "../../lib/useAsync.js";
import { useEditor, useEditorStore } from "../store/context.js";

export function VersionsDialog({ onNewVersion }: { onNewVersion: () => void }) {
  const store = useEditorStore();
  const cloud = useEditor((v) => v.cloud);
  const close = () => store.openDialog(null);
  const projectId = cloud?.projectId ?? null;
  const versions = useAsync(
    async () => (projectId === null ? [] : listVersions(projectId)),
    [projectId],
  );
  const [busy, setBusy] = useState<string | null>(null);

  if (cloud === null) {
    return (
      <Dialog title="Version history" onClose={close}>
        <p>
          Version history lives with cloud projects. Save this design to the cloud to start keeping
          versions; until then, undo and redo cover this session and the latest state is autosaved
          in this browser.
        </p>
      </Dialog>
    );
  }

  const restore = async (id: string, number: number) => {
    const ok = await confirmDialog({
      title: `Restore version ${number}?`,
      body: "The design is replaced by that version. Your current state stays in the history, and you can undo the restore.",
      confirmLabel: "Restore",
    });
    if (!ok) return;
    setBusy(id);
    try {
      const version = await getVersion(id);
      if (version === null) throw new Error("That version no longer exists.");
      store.loadFile(version.design);
      toast("success", `Restored version ${number}`);
      close();
    } catch (error) {
      toast("error", "Couldn't restore that version", errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      title="Version history"
      onClose={close}
      wide
      footer={
        !cloud.readOnly && (
          <button type="button" className="btn btn--primary" onClick={onNewVersion}>
            Create named version
          </button>
        )
      }
    >
      {versions.status === "error" && <p className="form-error">{versions.error.message}</p>}
      {versions.data === undefined ? (
        <Loading label="Loading versions" />
      ) : versions.data.length === 0 ? (
        <p className="dim">No versions yet.</p>
      ) : (
        <ul className="versions">
          {versions.data.map((v) => (
            <li key={v.id} className={v.is_autosave ? "" : "versions__named"}>
              <History aria-hidden="true" />
              <span className="mono">v{v.version_number}</span>
              <span>{v.label ?? (v.is_autosave ? "Autosave" : "Version")}</span>
              <span className="dim">{relativeTime(v.created_at)}</span>
              <span className="dim mono" title={v.design_hash}>
                {v.design_hash.slice(0, 8)}
              </span>
              {v.id === cloud.latestVersionId ? (
                <span className="badge">Current</span>
              ) : (
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={busy !== null}
                  onClick={() => void restore(v.id, v.version_number)}
                >
                  <RotateCcw /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="dim">
        The newest 50 autosaves are kept, plus every named version and any version with a verified
        score or a fork.
      </p>
    </Dialog>
  );
}

export function VersionNameDialog({ onCreate }: { onCreate: (label: string) => Promise<void> }) {
  const store = useEditorStore();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => store.openDialog(null);
  return (
    <Dialog
      title="Create a named version"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || label.trim() === ""}
            onClick={async () => {
              setBusy(true);
              try {
                await onCreate(label.trim());
                close();
              } finally {
                setBusy(false);
              }
            }}
          >
            Create version
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="input"
          autoFocus
          maxLength={120}
          value={label}
          placeholder="e.g. Thicker first wall"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <span className="field__hint">
          Named versions are kept forever and appear on the public page.
        </span>
      </label>
    </Dialog>
  );
}
