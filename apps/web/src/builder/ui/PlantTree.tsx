import {
  PLANT_SYSTEMS,
  PLANT_SYSTEM_LABELS,
  findComponentDefinition,
  plantSystemOf,
  type PlantSystem,
} from "@forgelab/reactor-components";
import type { SimulationComponent } from "@forgelab/sim-core";
import { ChevronDown, ChevronRight, Focus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { mass } from "../../lib/format.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { PartIcon } from "./PartIcon.js";

interface TypeGroup {
  readonly type: string;
  readonly name: string;
  readonly parts: readonly SimulationComponent[];
}

interface SystemGroup {
  readonly system: PlantSystem;
  readonly massKg: number;
  readonly types: readonly TypeGroup[];
  readonly count: number;
}

/** The design as a plant breakdown: systems, then part types, then parts. */
export function plantBreakdown(components: readonly SimulationComponent[]): SystemGroup[] {
  const bySystem = new Map<PlantSystem, SimulationComponent[]>();
  for (const c of components) {
    const s = plantSystemOf(c);
    const list = bySystem.get(s) ?? [];
    list.push(c);
    bySystem.set(s, list);
  }
  return PLANT_SYSTEMS.filter((s) => bySystem.has(s)).map((system) => {
    const parts = bySystem.get(system)!;
    const byType = new Map<string, SimulationComponent[]>();
    for (const c of parts) byType.set(c.type, [...(byType.get(c.type) ?? []), c]);
    return {
      system,
      massKg: parts.reduce((sum, c) => sum + c.massKg, 0),
      count: parts.length,
      types: [...byType].map(([type, list]) => ({
        type,
        name: findComponentDefinition(type)?.name ?? type,
        parts: list,
      })),
    };
  });
}

/**
 * The plant tree: the whole design as an engineer breaks it down. Click a part to select
 * and frame it; click a system's target to show that system on its own (everything else
 * ghosts). Selecting in 3D opens the branch that holds the selection.
 */
export function PlantTree() {
  const store = useEditorStore();
  const components = useEditor((v) => v.snapshot.components);
  const selection = useEditor((v) => v.selection);
  const focusSystem = useEditor((v) => v.focusSystem);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groups = useMemo(() => plantBreakdown(components), [components]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const totalKg = groups.reduce((sum, g) => sum + g.massKg, 0);
  // Branches holding the selection are open as well as the ones the user opened.
  const isOpen = (key: string, parts: readonly SimulationComponent[]) =>
    open.has(key) || parts.some((p) => selected.has(p.id));
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const pick = (ids: string[]) => {
    store.select(ids);
    store.requestFrame(ids);
  };

  return (
    <aside className="drawer tree" aria-label="Plant tree">
      <div className="drawer__head">
        <h2>Plant</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Close plant tree"
          onClick={() => store.toggleTree(false)}
        >
          <X />
        </button>
      </div>
      <p className="tree__summary">
        {components.length} parts · <span className="num">{mass(totalKg)}</span>
      </p>
      <div className="tree__body" role="tree" aria-label="Plant systems">
        {groups.length === 0 && <p className="tree__empty">Nothing built yet.</p>}
        {groups.map((g) => {
          const all = g.types.flatMap((t) => t.parts);
          const expanded = isOpen(g.system, all);
          return (
            <div key={g.system} className="tree__system" role="treeitem" aria-expanded={expanded}>
              <div
                className={`tree__row tree__row--system${focusSystem === g.system ? " is-focus" : ""}`}
              >
                <button
                  type="button"
                  className="tree__toggle"
                  onClick={() => toggle(g.system)}
                  aria-label={expanded ? "Collapse" : "Expand"}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </button>
                <button
                  type="button"
                  className="tree__name"
                  onClick={() => pick(all.map((p) => p.id))}
                  data-tip="Select the whole system"
                >
                  {PLANT_SYSTEM_LABELS[g.system]}
                  <span className="tree__count">{g.count}</span>
                </button>
                <span className="tree__mass num">{mass(g.massKg)}</span>
                <button
                  type="button"
                  className={`tree__isolate${focusSystem === g.system ? " is-active" : ""}`}
                  aria-pressed={focusSystem === g.system}
                  aria-label={`Show ${PLANT_SYSTEM_LABELS[g.system]} on its own`}
                  data-tip={
                    focusSystem === g.system ? "Show everything" : "Show this system on its own"
                  }
                  onClick={() => store.isolateSystem(g.system)}
                >
                  <Focus />
                </button>
              </div>
              {expanded &&
                g.types.map((t) => {
                  const key = `${g.system}/${t.type}`;
                  const single = t.parts.length === 1;
                  const typeOpen = !single && isOpen(key, t.parts);
                  return (
                    <div key={t.type} role="group">
                      {single ? (
                        <PartRow part={t.parts[0]!} selected={selected} onPick={pick} depth={1} />
                      ) : (
                        <>
                          <div className="tree__row tree__row--type">
                            <button
                              type="button"
                              className="tree__toggle"
                              onClick={() => toggle(key)}
                              aria-label={typeOpen ? "Collapse" : "Expand"}
                            >
                              {typeOpen ? <ChevronDown /> : <ChevronRight />}
                            </button>
                            <button
                              type="button"
                              className="tree__name"
                              onClick={() => pick(t.parts.map((p) => p.id))}
                            >
                              <PartIcon role={t.parts[0]!.role} />
                              {t.name}
                              <span className="tree__count">×{t.parts.length}</span>
                            </button>
                          </div>
                          {typeOpen &&
                            t.parts.map((p) => (
                              <PartRow
                                key={p.id}
                                part={p}
                                selected={selected}
                                onPick={pick}
                                depth={2}
                              />
                            ))}
                        </>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function PartRow({
  part,
  selected,
  onPick,
  depth,
}: {
  part: SimulationComponent;
  selected: ReadonlySet<string>;
  onPick: (ids: string[]) => void;
  depth: 1 | 2;
}) {
  return (
    <div
      className={`tree__row tree__row--part tree__row--d${depth}${selected.has(part.id) ? " is-selected" : ""}`}
      role="treeitem"
      aria-selected={selected.has(part.id)}
    >
      <button type="button" className="tree__name" onClick={() => onPick([part.id])}>
        <PartIcon role={part.role} />
        <span className="tree__label">{part.label ?? part.id}</span>
        <span className="tree__id">{part.id}</span>
      </button>
      <span className="tree__mass num">{mass(part.massKg)}</span>
    </div>
  );
}
