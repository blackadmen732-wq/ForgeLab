/** Durable project work. Presence/voice and engineering state remain separate. */
export const WORK_TYPES = ["build", "connect", "configure", "inspect", "repair"] as const;
export type WorkType = (typeof WORK_TYPES)[number];
export const WORK_PRIORITIES = ["low", "normal", "high"] as const;
export type WorkPriority = (typeof WORK_PRIORITIES)[number];
export const WORK_STATUSES = [
  "offered",
  "accepted",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export const WORK_STATUS_LABELS: Readonly<Record<WorkStatus, string>> = {
  offered: "Offered",
  accepted: "Accepted",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const WORK_TRANSITIONS: Readonly<Record<WorkStatus, readonly WorkStatus[]>> = {
  offered: ["accepted", "cancelled"],
  accepted: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};
export interface WorkOrder {
  readonly id: string;
  readonly projectId: string;
  readonly createdBy: string;
  readonly assignedTo: string;
  readonly targetComponentId: string;
  readonly targetVersionId: string | null;
  readonly taskType: WorkType;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkPriority;
  readonly status: WorkStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}
export interface NewWorkOrder {
  readonly assignedTo: string;
  readonly targetComponentId: string;
  readonly taskType: WorkType;
  readonly title: string;
  readonly description: string;
  readonly priority: WorkPriority;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[A-Za-z0-9:_-]{1,80}$/;
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const date = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const includes = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === "string" && values.includes(v as T);

/** Parse database rows, never trust a broadcast as a task record. Unknown fields dropped. */
export function parseWorkOrder(input: unknown): WorkOrder | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (!uuid(r["id"]) || !uuid(r["project_id"]) || !uuid(r["created_by"]) || !uuid(r["assigned_to"]))
    return null;
  if (!text(r["target_component_id"], 80) || !ID.test(r["target_component_id"])) return null;
  if (r["target_version_id"] !== null && !uuid(r["target_version_id"])) return null;
  if (
    !includes(WORK_TYPES, r["task_type"]) ||
    !includes(WORK_PRIORITIES, r["priority"]) ||
    !includes(WORK_STATUSES, r["status"])
  )
    return null;
  if (
    !text(r["title"], 120) ||
    r["title"].trim() !== r["title"] ||
    !r["title"] ||
    [...r["title"]].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return null;
  if (!text(r["description"], 2000) || !date(r["created_at"]) || !date(r["updated_at"]))
    return null;
  if (r["completed_at"] !== null && !date(r["completed_at"])) return null;
  if ((r["status"] === "completed") !== (r["completed_at"] !== null)) return null;
  return {
    id: r["id"],
    projectId: r["project_id"],
    createdBy: r["created_by"],
    assignedTo: r["assigned_to"],
    targetComponentId: r["target_component_id"],
    targetVersionId: r["target_version_id"],
    taskType: r["task_type"],
    title: r["title"],
    description: r["description"],
    priority: r["priority"],
    status: r["status"],
    createdAt: r["created_at"],
    updatedAt: r["updated_at"],
    completedAt: r["completed_at"],
  };
}

/** UI permission mirror; the database RPC locks, checks and performs the transition. */
export function workActions(
  order: WorkOrder,
  userId: string,
  canUpdate: boolean,
  canAssign: boolean,
): WorkStatus[] {
  const own = canUpdate && order.assignedTo === userId;
  return WORK_TRANSITIONS[order.status].filter((status) =>
    status === "cancelled" ? own || canAssign : own,
  );
}

/** An assignment can annotate actual focus. It never supplies or changes that focus. */
export function focusedWork(
  orders: readonly WorkOrder[],
  userId: string,
  focus: string,
): WorkOrder | undefined {
  return orders.find(
    (w) =>
      w.assignedTo === userId &&
      w.targetComponentId === focus &&
      (w.status === "accepted" || w.status === "in_progress" || w.status === "blocked"),
  );
}
