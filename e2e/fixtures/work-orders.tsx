/** Browser fixture only: production Team/Inspector controls, local Postgres test transport. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ROLE_PERMISSIONS, type Permission, type WorkOrder } from "@forgelab/protocol";
import { CollabController, type CollabState } from "../../apps/web/src/collab/controller.js";
import { CollabContext } from "../../apps/web/src/collab/context.js";
import { TeamPanel } from "../../apps/web/src/collab/TeamPanel.js";
import { AssignWork, WorkNotice } from "../../apps/web/src/collab/WorkPanel.js";
import type { WorkOrderPort } from "../../apps/web/src/collab/workOrders.js";
import "../../apps/web/src/styles/tokens.css";
import "../../apps/web/src/styles/base.css";
import "../../apps/web/src/collab/collab.css";

const actor = new URLSearchParams(location.search).get("actor") ?? "owner";
async function request<T>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(`/data/${action}?actor=${actor}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error);
  return value as T;
}
const initial = await request<{ projectId: string; userId: string; state: CollabState }>("initial");
const port: WorkOrderPort = {
  list: () => request<WorkOrder[]>("list"),
  create: (_project, draft) => request<WorkOrder>("create", draft),
  transition: (order, status) =>
    request<WorkOrder>("transition", { id: order.id, from: order.status, status }),
  subscribe: async (_project, changed) => {
    const events = new EventSource(`/events?actor=${actor}`);
    events.onmessage = changed;
    events.onopen = changed;
    return () => events.close();
  },
};
class FixtureController extends CollabController {
  override getState = () => initial.state;
  override can(permission: Permission): boolean {
    return initial.state.role !== null && ROLE_PERMISSIONS[initial.state.role].includes(permission);
  }
}
const controller = new FixtureController(initial.projectId, initial.userId, port);
await controller.work.start();
function Fixture() {
  const [focus, setFocus] = useState("pump");
  const [open, setOpen] = useState(true);
  return (
    <CollabContext.Provider value={controller}>
      <header className="fixture-head">
        <strong>ForgeLab · Local work-order check</strong>
        <span>Production controls and SQL migrations · test transport · {actor}</span>
      </header>
      <WorkNotice onFocus={setFocus} />
      <main className="fixture-layout">
        {open && (
          <TeamPanel
            onClose={() => setOpen(false)}
            onManage={() => {}}
            onFocusComponent={setFocus}
            componentExists={(id) => id === "pump"}
          />
        )}
        <section className="fixture-context">
          <h1>Coolant Pump</h1>
          <p>
            Focused component: <strong data-testid="focus">{focus}</strong>
          </p>
          <button type="button" className="btn" onClick={() => setFocus("coil")}>
            Inspect coil instead
          </button>
          <p>Work orders remain assigned when the player's actual focus changes.</p>
          <p>
            This fixture tests the work UI and database. It does not emulate Supabase Presence or
            LiveKit.
          </p>
        </section>
        <aside className="fixture-inspector">
          <h2>Inspector · Coolant Pump</h2>
          <AssignWork targetId="pump" targetLabel="Coolant Pump" />
        </aside>
      </main>
    </CollabContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
