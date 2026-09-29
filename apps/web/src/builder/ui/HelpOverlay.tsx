import { Dialog } from "../../components/Dialog.js";
import { COMMANDS } from "../commands.js";
import { useEditorStore } from "../store/context.js";

const EXTRA: readonly { group: string; label: string; keys: string }[] = [
  { group: "View", label: "Orbit", keys: "Left drag" },
  { group: "View", label: "Pan", keys: "Right drag" },
  { group: "View", label: "Zoom", keys: "Wheel" },
  { group: "Edit", label: "Add to / remove from selection", keys: "Shift click" },
  { group: "Tools", label: "Snap override while dragging", keys: "Hold Alt" },
];

export function HelpOverlay() {
  const store = useEditorStore();
  const groups = ["File", "Edit", "Tools", "View", "Simulation", "Help"] as const;
  return (
    <Dialog title="Keyboard shortcuts" onClose={() => store.setShowHelp(false)} wide>
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g}>
            <h3>{g}</h3>
            <dl>
              {[
                ...COMMANDS.filter((c) => c.group === g && c.keys),
                ...EXTRA.filter((e) => e.group === g),
              ].map((c) => (
                <div key={c.label}>
                  <dt>{c.label}</dt>
                  <dd>
                    {c.keys!.split(" ").map((k, i) => (
                      <kbd key={i} className="kbd">
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
