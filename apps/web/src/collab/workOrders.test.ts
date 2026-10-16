import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkOrder } from "@forgelab/protocol";
import { WorkOrderStore, type WorkOrderPort } from "./workOrders.js";

const order: WorkOrder = {
  id: "work-1",
  projectId: "project-1",
  createdBy: "owner",
  assignedTo: "member",
  targetComponentId: "pump-1",
  targetVersionId: "v1",
  taskType: "inspect",
  title: "Inspect pump",
  description: "",
  priority: "normal",
  status: "offered",
  createdAt: "2026-10-16T00:00:00Z",
  updatedAt: "2026-10-16T00:00:00Z",
  completedAt: null,
};
function fixture() {
  let rows: readonly WorkOrder[] = [];
  let invalidated = () => {};
  const cleanup = vi.fn();
  const port: WorkOrderPort = {
    list: vi.fn(async () => rows),
    create: vi.fn(async () => {
      rows = [order];
      invalidated();
      return order;
    }),
    transition: vi.fn(async (old, status) => {
      rows = [{ ...old, status }];
      invalidated();
      return rows[0]!;
    }),
    subscribe: vi.fn(async (_project, changed) => {
      invalidated = changed;
      return cleanup;
    }),
  };
  const store = new WorkOrderStore("project-1", "member", port);
  return {
    store,
    port,
    cleanup,
    rows: (next: readonly WorkOrder[]) => {
      rows = next;
    },
    event: () => invalidated(),
  };
}
afterEach(() => vi.useRealTimers());
describe("durable work cache", () => {
  it("reads on invalidation, not from its payload; notices new work and keeps progress after a fresh session", async () => {
    const f = fixture();
    await f.store.start();
    expect(f.store.getState().orders).toEqual([]);
    f.rows([order]);
    f.event();
    await f.store.refresh();
    expect(f.store.getState().notice?.id).toBe(order.id);
    f.store.dismissNotice();
    expect(f.store.getState().notice).toBeNull();
    await f.store.transition(order, "accepted");
    expect(f.store.getState().orders[0]?.status).toBe("accepted");
    f.store.stop();
    await f.store.start();
    expect(f.store.getState().orders[0]?.status).toBe("accepted");
    f.store.stop();
    expect(f.cleanup).toHaveBeenCalledTimes(2);
  });
  it("retries after offline reads and recovers missed broadcasts with a low-frequency read", async () => {
    vi.useFakeTimers();
    const f = fixture();
    vi.mocked(f.port.list).mockRejectedValueOnce(new Error("Offline"));
    await f.store.start();
    expect(f.store.getState().error).toBe("Offline");
    f.rows([order]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.store.getState()).toMatchObject({ error: null, orders: [order] });
    f.store.stop();
    const calls = vi.mocked(f.port.list).mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(vi.mocked(f.port.list).mock.calls).toHaveLength(calls);
  });
  it("ignores a stopped session's late reads and closes late subscriptions", async () => {
    const f = fixture();
    let deliver: ((rows: readonly WorkOrder[]) => void) | undefined;
    vi.mocked(f.port.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = f.store.refresh();
    f.store.stop();
    deliver!([order]);
    await pending;
    expect(f.store.getState().orders).toEqual([]);
    let subscribed: ((cleanup: () => void) => void) | undefined;
    vi.mocked(f.port.subscribe).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          subscribed = resolve;
        }),
    );
    const started = f.store.start();
    f.store.stop();
    subscribed!(f.cleanup);
    await started;
    expect(f.cleanup).toHaveBeenCalledOnce();
  });
  it("coalesces racing events but re-reads events arriving during a pending request", async () => {
    const f = fixture();
    let deliver: ((rows: readonly WorkOrder[]) => void) | undefined;
    vi.mocked(f.port.list).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pending = f.store.refresh();
    for (let i = 0; i < 10; i++) void f.store.refresh();
    f.rows([order]);
    deliver!([]);
    await pending;
    expect(vi.mocked(f.port.list)).toHaveBeenCalledTimes(2);
    expect(f.store.getState().orders).toEqual([order]);
    f.store.stop();
  });
  it("does not mutate the cache on a failed write and refreshes stale transition state", async () => {
    const f = fixture();
    f.rows([order]);
    await f.store.refresh();
    vi.mocked(f.port.transition).mockRejectedValueOnce(new Error("Work changed"));
    f.rows([{ ...order, status: "cancelled" }]);
    await expect(f.store.transition(order, "accepted")).rejects.toThrow("Work changed");
    expect(f.store.getState().orders[0]?.status).toBe("cancelled");
    expect(f.store.getState().notice).toBeNull();
    f.store.stop();
  });
});
