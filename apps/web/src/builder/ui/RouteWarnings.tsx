import { useEditor, useEditorStore } from "../store/context.js";

/** A blocked installation never silently masquerades as a physical pipe or cable. */
export function RouteWarnings() {
  const store = useEditorStore();
  const routes = useEditor((v) => v.serviceRoutes);
  const connections = useEditor((v) => v.snapshot.connections);
  const mode = useEditor((v) => v.mode);
  const blocked = routes.filter((r) => r.state === "blocked");
  if (mode !== "build" || !blocked.length) return null;
  return (
    <details className="route-warning" data-testid="route-warning">
      <summary>
        ⚠ {blocked.length} service {blocked.length === 1 ? "route needs" : "routes need"} clearance
      </summary>
      <p>
        Red dashed guides are unresolved links, not installed pipes or cables. Move equipment or
        clear space near its ports. Installation checks use approximate component shapes.
      </p>
      <ul>
        {blocked.slice(0, 4).map((r) => (
          <li key={r.id}>
            <span>
              {r.id}: no clear route found ·{" "}
              {r.blockers
                .slice(0, 3)
                .map((b) => b.label)
                .join(", ")}
            </span>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                const c = connections.find((c) => c.id === r.id);
                if (c) store.focusComponent(c.from.componentId);
              }}
            >
              Inspect {r.id}
            </button>
          </li>
        ))}
      </ul>
      <small>
        Existing endpoint links remain in the network model; ACTIVATE reports this limitation.
      </small>
    </details>
  );
}
