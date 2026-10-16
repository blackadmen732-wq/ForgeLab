import { useState, useSyncExternalStore } from "react";
import { ClipboardList, Crosshair } from "lucide-react";
import {
  WORK_STATUS_LABELS,
  WORK_TYPES,
  WORK_PRIORITIES,
  workActions,
  type WorkOrder,
  type WorkStatus,
  type WorkType,
  type WorkPriority,
} from "@forgelab/protocol";
import type { Member } from "../lib/collab.js";
import { errorMessage } from "../lib/toast.js";
import { useCollab, useCollabController, useWorkOrders } from "./context.js";
import type { WorkOrderStore } from "./workOrders.js";

const ACTION: Readonly<Record<WorkStatus, string>> = {
  offered: "Offer",
  accepted: "Accept",
  in_progress: "Start",
  blocked: "Mark blocked",
  completed: "Complete",
  cancelled: "Cancel",
};
const eligible = (member: Member) => member.role !== "viewer";
const memberName = (members: readonly Member[], id: string) => {
  const profile = members.find((m) => m.user_id === id)?.profile;
  return profile?.display_name || profile?.username || "Former member";
};

export function WorkPanel({
  work,
  userId,
  members,
  canAssign,
  canUpdate,
  onFocus,
  exists,
}: {
  work: WorkOrderStore;
  userId: string;
  members: readonly Member[];
  canAssign: boolean;
  canUpdate: boolean;
  onFocus: (id: string) => void;
  exists: (id: string) => boolean;
}) {
  const state = useSyncExternalStore(work.subscribe, work.getState);
  const [filter, setFilter] = useState("mine");
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const orders = state.orders.filter(
    (w) =>
      (filter !== "mine" || w.assignedTo === userId) &&
      (filter !== "managed" || w.createdBy === userId) &&
      (history
        ? w.status === "completed" || w.status === "cancelled"
        : w.status !== "completed" && w.status !== "cancelled"),
  );
  const transition = async (order: WorkOrder, status: WorkStatus) => {
    setBusy(order.id);
    setError(null);
    try {
      await work.transition(order, status);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="work" aria-label="Work orders">
      <header className="work__head">
        <ClipboardList aria-hidden="true" />
        <strong>Work orders</strong>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={() => void work.refresh()}
        >
          Refresh
        </button>
      </header>
      <div className="work__filters">
        <label className="visually-hidden" htmlFor="work-filter">
          Work order filter
        </label>
        <select
          id="work-filter"
          className="input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="mine">Assigned to me</option>
          {canAssign && <option value="managed">Created by me</option>}
          <option value="all">All team work</option>
        </select>
        <label>
          <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />{" "}
          History
        </label>
      </div>
      {(error || state.error) && (
        <p role="alert" className="form-error">
          {error ?? state.error}
        </p>
      )}
      {state.loading ? (
        <p className="dim">Loading work…</p>
      ) : orders.length === 0 ? (
        <p className="dim work__empty">
          {history
            ? "No recent completed or cancelled jobs."
            : "No work here. Select a machine to assign a job."}
        </p>
      ) : (
        <ul className="work__list">
          {orders.map((order) => (
            <li key={order.id} className="work__card" data-work-id={order.id}>
              <div className="work__meta">
                <span>
                  {order.taskType} · {order.priority} priority
                </span>
                <span className="badge">{WORK_STATUS_LABELS[order.status]}</span>
              </div>
              <strong>{order.title}</strong>
              <span className="dim">
                To {memberName(members, order.assignedTo)} · From{" "}
                {memberName(members, order.createdBy)}
              </span>
              {order.description && <p className="work__description">{order.description}</p>}
              <button
                type="button"
                className="btn btn--sm btn--ghost work__target"
                disabled={!exists(order.targetComponentId)}
                onClick={() => onFocus(order.targetComponentId)}
              >
                <Crosshair aria-hidden="true" /> Go to component · {order.targetComponentId}
              </button>
              {!exists(order.targetComponentId) && (
                <p className="dim">
                  Target is absent from this design. Load the latest project version to check it.
                </p>
              )}
              <div className="work__actions">
                {workActions(order, userId, canUpdate, canAssign).map((status) => (
                  <button
                    type="button"
                    className={`btn btn--sm${status === "accepted" || status === "completed" ? " btn--primary" : ""}`}
                    key={status}
                    disabled={busy !== null}
                    onClick={() => void transition(order, status)}
                  >
                    {status === "cancelled" &&
                    order.status === "offered" &&
                    order.assignedTo === userId
                      ? "Decline"
                      : status === "in_progress" && order.status === "blocked"
                        ? "Resume"
                        : ACTION[status]}
                  </button>
                ))}
              </div>
              {order.status === "completed" && (
                <small className="dim">
                  Marked complete by the assignee. Engineering success is checked by simulation.
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      {history && <p className="dim">Showing the 50 most recently closed jobs.</p>}
    </section>
  );
}

/** Assignment form is shared by the inspector and browser component checks. */
export function WorkAssignmentForm({
  work,
  members,
  targetId,
  targetLabel,
  onAssigned,
}: {
  work: WorkOrderStore;
  members: readonly Member[];
  targetId: string;
  targetLabel: string;
  onAssigned: () => void;
}) {
  const editors = members.filter(eligible);
  const [assignee, setAssignee] = useState(editors[0]?.user_id ?? "");
  const [taskType, setTaskType] = useState<WorkType>("inspect");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<WorkPriority>("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work.create({
        assignedTo: assignee,
        targetComponentId: targetId,
        taskType,
        title: title.trim() || `${taskType[0]!.toUpperCase()}${taskType.slice(1)} ${targetLabel}`,
        description,
        priority,
      });
      onAssigned();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="work__form"
      aria-label="Assign work"
      onKeyDown={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>
        Target: <strong>{targetLabel}</strong>
      </p>
      <label>
        Assign to
        <select
          className="input"
          aria-label="Assign to"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
        >
          {editors.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {memberName(members, m.user_id)}
            </option>
          ))}
        </select>
      </label>
      <div className="work__filters">
        <label>
          Task
          <select
            className="input"
            aria-label="Task type"
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as WorkType)}
          >
            {WORK_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            className="input"
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as WorkPriority)}
          >
            {WORK_PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Title (optional)
        <input
          className="input"
          aria-label="Work title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder={`${taskType} ${targetLabel}`}
        />
      </label>
      <label>
        Notes (optional)
        <textarea
          className="input"
          aria-label="Work notes"
          rows={2}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <p className="dim">
        Save new components to this cloud project first. Completion is a teammate's report, not an
        automatic engineering check.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="btn btn--primary btn--sm"
        disabled={busy || !editors.some((m) => m.user_id === assignee)}
      >
        {busy ? "Assigning…" : "Assign job"}
      </button>
    </form>
  );
}

export function AssignWork({ targetId, targetLabel }: { targetId: string; targetLabel: string }) {
  const controller = useCollabController();
  const members = useCollab((s) => s.members) ?? [];
  const [open, setOpen] = useState(false);
  const [assigned, setAssigned] = useState(false);
  if (!controller?.can("can_assign_work")) return null;
  return (
    <section className="work__assign">
      <button
        type="button"
        className="btn btn--sm"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setAssigned(false);
        }}
      >
        <ClipboardList aria-hidden="true" /> Assign Work
      </button>
      {assigned && <p role="status">Work assigned. Follow progress in Team → Work.</p>}
      {open && (
        <WorkAssignmentForm
          key={targetId}
          work={controller.work}
          members={members}
          targetId={targetId}
          targetLabel={targetLabel}
          onAssigned={() => {
            setOpen(false);
            setAssigned(true);
          }}
        />
      )}
    </section>
  );
}

export function WorkNotice({ onFocus }: { onFocus: (id: string) => void }) {
  const controller = useCollabController();
  const state = useWorkOrders();
  const notice = state?.notice;
  if (!notice || !controller) return null;
  return (
    <div className="readonly-banner collab-banner" role="status">
      <ClipboardList aria-hidden="true" />
      <span>
        Assigned to you: <strong>{notice.title}</strong> · Accept in Team → Work.
      </span>
      <button
        type="button"
        className="btn btn--sm"
        onClick={() => onFocus(notice.targetComponentId)}
      >
        Go to component
      </button>
      <button
        type="button"
        className="btn btn--sm btn--ghost"
        onClick={controller.work.dismissNotice}
      >
        Dismiss
      </button>
    </div>
  );
}
