import { FilePlus2, GraduationCap, HardDrive, LayoutTemplate, TriangleAlert } from "lucide-react";
import { SHOWROOM_SCENARIOS, buildScenario } from "@forgelab/reactor-components";
import { Dialog } from "../../components/Dialog.js";
import { confirmDialog } from "../../lib/confirm.js";
import { relativeTime } from "../../lib/format.js";
import { BLUEPRINTS, buildInteractiveStarter } from "../blueprints.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { readLocalDraft } from "../store/persistence.js";

export function StartDialog({
  onStart,
}: {
  onStart: (kind: "blank" | "starter" | "draft" | "blueprint") => void;
}) {
  const store = useEditorStore();
  const count = useEditor((v) => v.snapshot.components.length);
  const cloud = useEditor((v) => v.cloud);
  const draft = readLocalDraft();
  const showDraft = draft !== null && draft.file.components.length > 0 && count === 0;

  const guard = async (): Promise<boolean> => {
    if (count === 0) return true;
    return confirmDialog({
      title: "Replace the current design?",
      body:
        cloud !== null && !cloud.readOnly
          ? "It is saved in your cloud project; you can reopen it from My projects."
          : "It is only kept in this browser's autosave, which the new design will replace. Export it first if you want to keep it.",
      confirmLabel: "Replace",
      danger: cloud === null,
    });
  };

  const close = () => store.openDialog(null);

  return (
    <Dialog title="Start building" onClose={close} wide>
      <div className="start">
        {showDraft && (
          <button
            type="button"
            className="start__option start__option--draft"
            onClick={() => {
              store.loadFile(draft.file);
              onStart("draft");
              close();
            }}
          >
            <HardDrive aria-hidden="true" />
            <span>
              <strong>Continue “{draft.file.name}”</strong>
              <span className="dim">
                Autosaved in this browser {relativeTime(draft.savedAt)} ·{" "}
                {draft.file.components.length} parts
              </span>
            </span>
          </button>
        )}
        <button
          type="button"
          className="start__option start__option--primary"
          autoFocus
          onClick={async () => {
            if (!(await guard())) return;
            store.newBlank();
            onStart("blank");
            close();
          }}
        >
          <FilePlus2 aria-hidden="true" />
          <span>
            <strong>Blank project</strong>
            <span className="dim">
              An empty, open workspace. Place parts, connect them, run them.
            </span>
          </span>
        </button>
        <button
          type="button"
          className="start__option"
          onClick={async () => {
            if (!(await guard())) return;
            store.replaceWorld(buildInteractiveStarter(), { blueprintId: "interactive-starter" });
            onStart("starter");
            close();
          }}
        >
          <GraduationCap aria-hidden="true" />
          <span>
            <strong>Interactive starter</strong>
            <span className="dim">
              A nearly-working fusion plant with one problem. Hints walk you through running it,
              reading the failure, and fixing it.
            </span>
          </span>
        </button>
        <h3 className="start__heading">
          <LayoutTemplate aria-hidden="true" /> Blueprints
        </h3>
        <div className="start__grid">
          {BLUEPRINTS.map((b) => (
            <button
              key={b.id}
              type="button"
              className="start__blueprint"
              onClick={async () => {
                if (!(await guard())) return;
                store.replaceWorld(b.build(), { blueprintId: b.id });
                onStart("blueprint");
                close();
              }}
            >
              <strong>{b.name}</strong>
              <span className="dim">{b.description}</span>
              <span className="badge">{b.size}</span>
            </button>
          ))}
        </div>
        <h3 className="start__heading">
          <TriangleAlert aria-hidden="true" /> Failure scenes
        </h3>
        <p className="dim start__note">
          Working designs with one engineering mistake each. Nothing is scripted: run one and the
          simulation decides what fails, when, and how hard.
        </p>
        <div className="start__grid">
          {SHOWROOM_SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="start__blueprint"
              data-scene={s.id}
              onClick={async () => {
                if (!(await guard())) return;
                store.replaceWorld(buildScenario(s.id), { blueprintId: `scene:${s.id}` });
                onStart("blueprint");
                close();
              }}
            >
              <strong>{s.name}</strong>
              <span className="dim">{s.fault}</span>
              <span className="badge">{s.expectedFailureType.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
