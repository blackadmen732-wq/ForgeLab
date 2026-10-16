import { describe, expect, it } from "vitest";
import { focusedWork, parseWorkOrder, workActions } from "./workOrders.js";
import { projectWorkspaceId } from "./ids.js";
const ID = "00000000-0000-4000-8000-000000000001";
const row = {
  id: ID,
  project_id: ID,
  created_by: ID,
  assigned_to: ID,
  target_component_id: "pump:1",
  target_version_id: ID,
  task_type: "inspect",
  title: "Inspect pump",
  description: "Interfaces",
  priority: "normal",
  status: "accepted",
  created_at: "2026-10-16T00:00:00Z",
  updated_at: "2026-10-16T00:00:00Z",
  completed_at: null,
};
describe("work protocol", () => {
  it("uses one shared project area while preserving different projects' workspace boundaries", () => {
    expect(projectWorkspaceId(ID)).toBe(`ws:project:${ID}`);
    expect(projectWorkspaceId(ID.toUpperCase())).toBe(projectWorkspaceId(ID));
    expect(projectWorkspaceId(ID.replace(/1$/, "2"))).not.toBe(projectWorkspaceId(ID));
    expect(() => projectWorkspaceId("not-a-project")).toThrow();
  });
  it("strictly parses bounded durable rows, discarding untrusted extras", () => {
    expect(parseWorkOrder({ ...row, physics: { working: true } })).toMatchObject({
      targetComponentId: "pump:1",
      status: "accepted",
    });
    expect(parseWorkOrder(row)).not.toHaveProperty("physics");
    for (const bad of [
      null,
      {},
      { ...row, assigned_to: "Maya" },
      { ...row, status: "working" },
      { ...row, title: "A".repeat(121) },
      { ...row, title: "\n" },
      { ...row, description: "A".repeat(2001) },
      { ...row, target_component_id: "<script>" },
      { ...row, updated_at: "no" },
      { ...row, status: "completed" },
      { ...row, completed_at: row.created_at },
    ])
      expect(parseWorkOrder(bad)).toBeNull();
  });
  it("keeps assignments separate from actual presence and clears only the matching close label", () => {
    const order = parseWorkOrder(row)!;
    expect(focusedWork([order], ID, "pump:1")).toBe(order);
    expect(focusedWork([order], ID, "coil:1")).toBeUndefined();
    expect(focusedWork([order], "another-user", "pump:1")).toBeUndefined();
    for (const status of ["offered", "completed", "cancelled"] as const)
      expect(focusedWork([{ ...order, status }], ID, "pump:1")).toBeUndefined();
  });
  it("offers only the assignee's allowed transitions or a manager's cancel action", () => {
    const order = parseWorkOrder(row)!;
    expect(workActions(order, ID, true, false)).toEqual(["in_progress", "blocked", "cancelled"]);
    expect(workActions(order, ID, false, false)).toEqual([]);
    expect(workActions(order, "manager", true, true)).toEqual(["cancelled"]);
    expect(workActions({ ...order, status: "completed" }, ID, true, true)).toEqual([]);
  });
});
