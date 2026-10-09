import {
  COMPONENT_CATEGORIES,
  COMPONENT_DEFINITIONS,
  KITS,
  type ComponentDefinition,
} from "@forgelab/reactor-components";
import { type AssemblyFileV2, extractAssembly } from "@forgelab/sim-core";
import { getMaterial } from "@forgelab/materials";
import { Boxes, LayoutTemplate, Save, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { assemblyLibrary } from "../assemblyLibrary.js";
import { metres } from "../../lib/format.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { PartIcon } from "./PartIcon.js";
import { toast } from "../../lib/toast.js";

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
        <AssembliesSection query={query} />
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

/** Kits as assembly files, built once on first use. */
let kitFiles: ReadonlyMap<string, AssemblyFileV2> | null = null;
function kitFile(id: string): AssemblyFileV2 | undefined {
  kitFiles ??= new Map(
    KITS.map((kit) => {
      const world = kit.build();
      return [
        kit.id,
        extractAssembly(
          world,
          world.listComponents().map((c) => c.id),
          kit.name,
        ),
      ];
    }),
  );
  return kitFiles.get(id);
}

/**
 * Assemblies: built-in kits and the player's own saved pieces. Placing one puts its parts
 * down grouped, with their links; Ctrl Shift G takes it apart.
 */
function AssembliesSection({ query }: { query: string }) {
  const store = useEditorStore();
  const building = useEditor((v) => v.mode === "build");
  const selectionCount = useEditor((v) => v.selection.length);
  const saved = useSyncExternalStore(assemblyLibrary.subscribe, assemblyLibrary.list);
  const [naming, setNaming] = useState<string | null>(null);
  const q = query.toLowerCase();
  const show = (text: string) => q === "" || text.toLowerCase().includes(q);
  const kits = KITS.filter((k) => show(`${k.name} ${k.description} assembly kit`));
  const mine = saved.filter((a) => show(`${a.name} assembly`));
  const save = () => {
    const name = (naming ?? "").trim() || "My assembly";
    const file = store.selectionAsAssembly(name);
    if (file === null) return;
    if (!assemblyLibrary.add(name, file))
      toast("error", "Could not save the assembly", "This browser's storage is full or disabled.");
    else toast("success", `Saved “${name}”`, "It is under My assemblies in the parts drawer.");
    setNaming(null);
  };
  if (kits.length === 0 && mine.length === 0 && q !== "") return null;
  return (
    <section className="drawer__group" aria-label="Assemblies">
      <h3>Assemblies</h3>
      {kits.map((kit) => (
        <button
          key={kit.id}
          type="button"
          className="part"
          disabled={!building}
          onClick={() => store.placeAssembly(kitFile(kit.id), kit.name)}
          title={`${kit.description}\n\nPlaces as a group. Alt-click picks one part; Ctrl Shift G takes it apart.`}
        >
          <Boxes aria-hidden="true" />
          <span className="part__text">
            <span className="part__name">{kit.name}</span>
            <span className="part__meta">
              Kit · {kitFile(kit.id)?.components.length ?? 0} parts
            </span>
          </span>
        </button>
      ))}
      {mine.length > 0 && <h3>My assemblies</h3>}
      {mine.map((a) => (
        <div key={a.id} className="part part--saved">
          <button
            type="button"
            className="part__place"
            disabled={!building}
            onClick={() => store.placeAssembly(a.file, a.name)}
            title="Place a copy, grouped, near the view centre."
          >
            <Boxes aria-hidden="true" />
            <span className="part__text">
              <span className="part__name">{a.name}</span>
              <span className="part__meta">{a.parts} parts</span>
            </span>
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--icon btn--sm"
            aria-label={`Delete ${a.name}`}
            onClick={() => assemblyLibrary.remove(a.id)}
          >
            <Trash2 />
          </button>
        </div>
      ))}
      {naming === null ? (
        <button
          type="button"
          className="btn btn--sm drawer__save"
          disabled={!building || selectionCount === 0}
          onClick={() => setNaming("")}
          title="Save the selected parts and the links between them as an assembly you can place again."
        >
          <Save aria-hidden="true" /> Save selection as assembly
        </button>
      ) : (
        <form
          className="drawer__save-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            className="input"
            autoFocus
            maxLength={80}
            placeholder="Assembly name"
            aria-label="Assembly name"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
          />
          <button type="submit" className="btn btn--sm btn--primary">
            Save
          </button>
        </form>
      )}
    </section>
  );
}
