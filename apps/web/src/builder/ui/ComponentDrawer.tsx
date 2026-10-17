import {
  COMPONENT_CATEGORIES,
  COMPONENT_DEFINITIONS,
  KITS,
  ASSEMBLY_RECIPES,
  type ComponentDefinition,
} from "@forgelab/reactor-components";
import { constructionPart, type AssemblyFileV2, extractAssembly } from "@forgelab/sim-core";
import { getMaterial } from "@forgelab/materials";
import { ArrowUpRight, Boxes, Cog, LayoutTemplate, Save, Search, Trash2, X } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { assemblyLibrary } from "../assemblyLibrary.js";
import { metres } from "../../lib/format.js";
import { useEditor, useEditorStore } from "../store/context.js";
import { PartIcon } from "./PartIcon.js";
import { toast } from "../../lib/toast.js";
import { analytics } from "../../lib/analytics.js";

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
        if (constructionPart(definition.type)) store.beginPlacement(definition.type);
      }}
      onDragEnd={() => store.cancelPlacement()}
      onClick={() =>
        constructionPart(definition.type)
          ? store.beginPlacement(definition.type)
          : store.addPart(definition.type)
      }
      title={`${definition.description}\n\nClick to place near the view centre, or drag into the workspace.`}
    >
      <PartIcon role={definition.role} />
      <span className="part__text">
        <span className="part__name">{definition.name}</span>
        {constructionPart(definition.type) && (
          <span className="part__purpose">
            {constructionPart(definition.type)?.purpose ?? definition.description.split(".")[0]}
          </span>
        )}
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
  const [tab, setTab] = useState<"parts" | "kits" | "mine">("parts");
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
      <nav className="drawer__tabs" aria-label="Component library sections">
        {(
          [
            ["parts", "Parts"],
            ["kits", "Kits"],
            ["mine", "My Assemblies"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            className={`btn btn--sm ${tab === key ? "btn--primary" : "btn--ghost"}`}
            aria-pressed={tab === key}
            onClick={() => {
              setTab(key);
              setQuery("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
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
      {tab === "parts" && (
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
      )}
      <div className="drawer__list">
        {tab === "parts" && query === "" && category === null && <MachineWorkshop />}
        {tab === "parts" && groups.length === 0 && (
          <p className="dim drawer__empty">No parts match “{query}”.</p>
        )}
        {tab === "parts" &&
          groups.map((g) => (
            <section key={g.category} className="drawer__group">
              <h3>{g.category}</h3>
              {g.parts.map((d) => (
                <PartCard key={d.type} definition={d} />
              ))}
            </section>
          ))}
        {tab !== "parts" && <AssembliesSection query={query} tab={tab} />}
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

/** Entry into actual loose-module construction, not a preassembled showcase or tutorial movie. */
function MachineWorkshop() {
  const store = useEditorStore();
  const building = useEditor((v) => v.mode === "build");
  const recipes = [...ASSEMBLY_RECIPES].sort(
    (a, b) => Number(a.resultType === "coolant-pump") - Number(b.resultType === "coolant-pump"),
  );
  return (
    <section className="machine-workshop" aria-label="Build machines from modules">
      <div className="machine-workshop__heading">
        <Cog aria-hidden="true" />
        <div>
          <h3>Build a machine</h3>
          <p>Place the pieces. Mate the mounts. Connect your plant.</p>
        </div>
      </div>
      {recipes.map((r) => (
        <article key={r.id} className={`machine-kit machine-kit--${r.resultType}`}>
          <div className="machine-kit__title">
            <strong>{r.name.replace("Modular ", "")}</strong>
            <span>{r.parts.length} modules</span>
          </div>
          <div className="machine-kit__diagram" aria-hidden="true">
            {r.parts.map((p, i) => (
              <span key={p.key} className={`machine-kit__block machine-kit__block--${p.key}`}>
                <b>{String(i + 1).padStart(2, "0")}</b>
                {p.key === "casing"
                  ? r.resultType === "generator"
                    ? "Stator"
                    : "Casing"
                  : p.key === "base"
                    ? "Bedplate"
                    : p.key === "drive"
                      ? "Drive"
                      : p.key === "chest"
                        ? "Steam inlet"
                        : p.key === "terminals"
                          ? "Terminals"
                          : p.key === "motor"
                            ? "Motor"
                            : "Rotor"}
              </span>
            ))}
          </div>
          <p>
            {r.resultType === "generator"
              ? "Shaft motion → electrical power"
              : r.resultType === "steam-turbine"
                ? "Steam heat → shaft power"
                : "Electrical power → coolant flow"}
          </p>
          <button
            type="button"
            className="btn btn--sm machine-kit__start"
            disabled={!building}
            onClick={() => {
              const file = kitFile(r.id);
              if (file && store.placeAssembly(file, r.name)) store.frameSelection();
            }}
          >
            Build{" "}
            {r.resultType === "generator"
              ? "generator"
              : r.resultType === "steam-turbine"
                ? "turbine"
                : "pump"}
            <ArrowUpRight aria-hidden="true" />
          </button>
        </article>
      ))}
      <p className="machine-workshop__note">
        Loose modules stay inactive until their construction is complete. Finished machines remain
        below.
      </p>
    </section>
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
function AssembliesSection({ query, tab }: { query: string; tab: "kits" | "mine" }) {
  const store = useEditorStore();
  const building = useEditor((v) => v.mode === "build");
  const selectionCount = useEditor((v) => v.selection.length);
  const saved = useSyncExternalStore(assemblyLibrary.subscribe, assemblyLibrary.list);
  const [naming, setNaming] = useState<string | null>(null);
  const q = query.toLowerCase();
  const show = (text: string) => q === "" || text.toLowerCase().includes(q);
  const kits = (tab === "kits" ? KITS : []).filter((k) =>
    show(`${k.name} ${k.description} assembly kit`),
  );
  const mine = (tab === "mine" ? saved : []).filter((a) => show(`${a.name} assembly`));
  const save = () => {
    const name = (naming ?? "").trim() || "My assembly";
    const file = store.selectionAsAssembly(name);
    if (file === null) return;
    if (!assemblyLibrary.add(name, file))
      toast("error", "Could not save the assembly", "This browser's storage is full or disabled.");
    else {
      analytics.track("assembly_saved", { parts: file.components.length });
      toast("success", `Saved “${name}”`, "It is under My assemblies in the parts drawer.");
    }
    setNaming(null);
  };
  if (kits.length === 0 && mine.length === 0 && q !== "") return null;
  return (
    <section className="drawer__group" aria-label="Assemblies">
      <h3>{tab === "kits" ? "Built-in kits" : "My Assemblies"}</h3>
      {kits.map((kit) => (
        <button
          key={kit.id}
          type="button"
          className="part"
          disabled={!building}
          onClick={() => {
            if (store.placeAssembly(kitFile(kit.id), kit.name))
              analytics.track("kit_placed", { kit: kit.id });
          }}
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
      {tab === "mine" &&
        (naming === null ? (
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
        ))}
    </section>
  );
}
