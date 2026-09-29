import {
  COMPONENT_CATEGORIES,
  COMPONENT_DEFINITIONS,
  type ComponentDefinition,
} from "@forgelab/reactor-components";
import { getMaterial } from "@forgelab/materials";
import { LayoutTemplate, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { metres } from "../../lib/format.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { PartIcon } from "./PartIcon.js";

function matches(definition: ComponentDefinition, query: string): boolean {
  if (query === "") return true;
  const haystack =
    `${definition.name} ${definition.category} ${definition.description} ${definition.role} ${definition.keyProperty}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

function PartCard({ definition }: { definition: ComponentDefinition }) {
  const store = useEditorStore();
  const building = useEditor((v) => v.mode === "build");
  const size = definition.nominalSizeM;
  return (
    <button
      type="button"
      className="part"
      draggable={building}
      disabled={!building}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-forgelab-part", definition.type);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => store.addPart(definition.type)}
      title={`${definition.description}\n\nClick to place near the view centre, or drag into the workspace.`}
    >
      <PartIcon role={definition.role} />
      <span className="part__text">
        <span className="part__name">{definition.name}</span>
        <span className="part__key">{definition.keyProperty}</span>
        <span className="part__meta">
          {metres(size.x)} × {metres(size.y)} × {metres(size.z)} ·{" "}
          {getMaterial(definition.defaultMaterialId).name}
        </span>
      </span>
    </button>
  );
}

export function ComponentDrawer() {
  const store = useEditorStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const groups = useMemo(() => {
    return COMPONENT_CATEGORIES.map((c) => ({
      category: c,
      parts: COMPONENT_DEFINITIONS.filter(
        (d) => d.category === c && matches(d, query) && (category === null || category === c),
      ),
    })).filter((g) => g.parts.length > 0);
  }, [query, category]);

  return (
    <aside className="drawer" aria-label="Parts">
      <div className="drawer__head">
        <h2>Parts</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          aria-label="Close parts drawer"
          onClick={() => store.toggleDrawer(false)}
        >
          <X />
        </button>
      </div>
      <div className="drawer__search">
        <Search aria-hidden="true" />
        <input
          className="input"
          placeholder="Search parts"
          aria-label="Search parts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="chips" role="toolbar" aria-label="Categories">
        <button
          type="button"
          className={`chip${category === null ? " is-active" : ""}`}
          onClick={() => setCategory(null)}
        >
          All
        </button>
        {COMPONENT_CATEGORIES.filter((c) =>
          COMPONENT_DEFINITIONS.some((d) => d.category === c),
        ).map((c) => (
          <button
            key={c}
            type="button"
            className={`chip${category === c ? " is-active" : ""}`}
            onClick={() => setCategory(category === c ? null : c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="drawer__list">
        {groups.length === 0 && <p className="dim drawer__empty">No parts match “{query}”.</p>}
        {groups.map((g) => (
          <section key={g.category} className="drawer__group">
            <h3>{g.category}</h3>
            {g.parts.map((d) => (
              <PartCard key={d.type} definition={d} />
            ))}
          </section>
        ))}
        <section className="drawer__group">
          <h3>Blueprints</h3>
          <button
            type="button"
            className="part part--blueprint"
            onClick={() => store.openDialog("start")}
          >
            <LayoutTemplate aria-hidden="true" />
            <span className="part__text">
              <span className="part__name">Start from a blueprint…</span>
              <span className="part__meta">Reference plant, structural rigs, benchmark</span>
            </span>
          </button>
        </section>
      </div>
    </aside>
  );
}
