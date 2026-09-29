import { COMPONENT_DEFINITIONS } from "@forgelab/reactor-components";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { COMMANDS, type CommandContext } from "../commands.js";
import { useEditor, useEditorStore } from "../store/context.js";

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly disabled: boolean;
  run(): void;
}

function score(label: string, query: string): number {
  if (query === "") return 1;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (l.includes(q)) return 2;
  // Subsequence match: "cpump" → "Coolant Pump".
  let i = 0;
  for (const ch of l) if (ch === q[i]) i += 1;
  return i === q.length ? 1 : 0;
}

export function CommandPalette({ context }: { context: CommandContext }) {
  const store = useEditorStore();
  const view = useEditor();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const close = () => store.setShowPalette(false);

  const entries = useMemo<Entry[]>(() => {
    const commands: Entry[] = COMMANDS.filter((c) => c.id !== "palette").map((c) => ({
      id: c.id,
      label: c.label,
      hint: c.keys ?? c.group,
      disabled: c.enabled ? !c.enabled(view) : false,
      run: () => c.run(context),
    }));
    const parts: Entry[] = COMPONENT_DEFINITIONS.map((d) => ({
      id: `add-${d.type}`,
      label: `Add ${d.name}`,
      hint: d.category,
      disabled: view.mode !== "build",
      run: () => store.addPart(d.type),
    }));
    const find: Entry[] = view.snapshot.components.map((c) => ({
      id: `find-${c.id}`,
      label: `Go to ${c.label || c.id}`,
      hint: c.id,
      disabled: false,
      run: () => store.focusComponent(c.id),
    }));
    return [...commands, ...parts, ...find]
      .map((e) => ({ e, s: score(e.label, query.trim()) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.e);
  }, [query, view, context, store]);

  const run = (entry: Entry | undefined) => {
    if (entry === undefined || entry.disabled) return;
    close();
    entry.run();
  };

  return (
    <div
      className="dialog-backdrop dialog-backdrop--top"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette__search">
          <Search aria-hidden="true" />
          <input
            autoFocus
            className="palette__input"
            placeholder="Type a command, a part to add, or a part to find…"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `pal-${entries[active].id}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(entries.length - 1, a + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              }
              if (e.key === "Enter") run(entries[active]);
            }}
          />
        </div>
        <ul className="palette__list" id="palette-list" role="listbox">
          {entries.length === 0 && <li className="palette__empty dim">No matches.</li>}
          {entries.map((e, i) => (
            <li
              key={e.id}
              id={`pal-${e.id}`}
              role="option"
              aria-selected={i === active}
              aria-disabled={e.disabled}
              className={`palette__item${i === active ? " is-active" : ""}${e.disabled ? " is-disabled" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                run(e);
              }}
            >
              <span>{e.label}</span>
              <span className="palette__hint">{e.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
