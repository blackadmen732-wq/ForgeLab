import {
  parseWorkOrder,
  type NewWorkOrder,
  type WorkOrder,
  type WorkStatus,
} from "@forgelab/protocol";
import { collabRpc } from "./collab.js";
import { requireSupabase } from "./supabase.js";

export async function listWorkOrders(projectId: string): Promise<WorkOrder[]> {
  const db = await requireSupabase();
  const [active, history] = await Promise.all([
    db
      .from("work_orders")
      .select("*")
      .eq("project_id", projectId)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("work_orders")
      .select("*")
      .eq("project_id", projectId)
      .in("status", ["completed", "cancelled"])
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  if (active.error || history.error) throw new Error((active.error ?? history.error)!.message);
  return [...(active.data ?? []), ...(history.data ?? [])].map(readOrder);
}
function readOrder(row: unknown): WorkOrder {
  const order = parseWorkOrder(row);
  if (!order) throw new Error("The server returned an unreadable work order.");
  return order;
}
export async function createWorkOrder(projectId: string, draft: NewWorkOrder): Promise<WorkOrder> {
  return readOrder(
    await collabRpc("create_work_order", {
      p_project: projectId,
      p_assignee: draft.assignedTo,
      p_component: draft.targetComponentId,
      p_type: draft.taskType,
      p_title: draft.title,
      p_description: draft.description,
      p_priority: draft.priority,
    }),
  );
}
export async function transitionWorkOrder(
  order: WorkOrder,
  status: WorkStatus,
): Promise<WorkOrder> {
  return readOrder(
    await collabRpc("transition_work_order", {
      p_id: order.id,
      p_expected_status: order.status,
      p_status: status,
    }),
  );
}

/** Existing Supabase private Broadcast transport. Only the database publishes here. */
export async function subscribeWorkOrders(
  projectId: string,
  changed: () => void,
): Promise<() => void> {
  const db = await requireSupabase();
  const channel = db.channel(`work:${projectId}`, { config: { private: true } });
  channel.on("broadcast", { event: "work.changed" }, ({ payload }) => {
    if (payload?.project_id === projectId) changed();
  });
  try {
    await db.realtime.setAuth();
  } catch (error) {
    await db.removeChannel(channel);
    throw error;
  }
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") changed(); // Re-read after every reconnect, not only first join.
  });
  return () => void db.removeChannel(channel);
}
