import { SYSTEMS, showsInternals } from "../scene/Internals.js";
import { useEditor } from "../store/context.js";

/**
 * Says what the internal views are whenever they are on screen: schematic, not a
 * manufacturer's design. The Internal Systems view also gets its colour legend.
 */
export function InternalsNotice() {
  const cutaway = useEditor((v) => v.cutaway);
  const overlay = useEditor((v) => v.overlay);
  const selection = useEditor((v) => v.selection);
  const components = useEditor((v) => v.snapshot.components);
  const systems = overlay === "internals";
  const cutOpen =
    cutaway && components.some((c) => selection.includes(c.id) && showsInternals(c.type));
  if (!systems && !cutOpen) return null;
  return (
    <aside className="internals-notice" aria-label="About the internal view">
      <strong>Schematic internal representation</strong>
      <span className="dim">
        Arrangement and proportions are representative of the machine type, not a
        manufacturer&apos;s design.
      </span>
      {systems && (
        <ul className="internals-notice__legend">
          {SYSTEMS.map((s) => (
            <li key={s.id}>
              <span className="internals-notice__key" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
