import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseWorkOrder, WORK_TRANSITIONS, type WorkStatus } from "@forgelab/protocol";
import { createTestDatabase, DESIGN, HASH, type TestDatabase } from "./harness.js";

const OWNER = "00000000-0000-4000-8000-0000000000b1";
const ADMIN = "00000000-0000-4000-8000-0000000000b2";
const MEMBER = "00000000-0000-4000-8000-0000000000b3";
const VIEWER = "00000000-0000-4000-8000-0000000000b4";
const OTHER = "00000000-0000-4000-8000-0000000000b5";
let t: TestDatabase;
let project: string;
const create = async (user = OWNER, assigned = MEMBER, target = "a", projectId = project) =>
  (
    await t.as<{ w: Record<string, unknown> }>(
      user,
      `select to_jsonb(public.create_work_order($1,$2,$3,'inspect','Inspect the pump','Check its interfaces','normal')) as w`,
      [projectId, assigned, target],
    )
  )[0]!.w;
const transition = async (user: string, id: unknown, from: string | null, to: string | null) =>
  (
    await t.as<{ w: Record<string, unknown> }>(
      user,
      `select to_jsonb(public.transition_work_order($1,$2,$3)) as w`,
      [id, from, to],
    )
  )[0]!.w;

beforeAll(async () => {
  t = await createTestDatabase();
  for (const [i, id] of [OWNER, ADMIN, MEMBER, VIEWER, OTHER].entries())
    await t.signUp(id, `work${i}@example.com`, { username: `work${i}` });
  project = (
    await t.as<{ id: string }>(
      OWNER,
      `insert into public.projects(name,slug) values('Work test','work-test') returning id`,
    )
  )[0]!.id;
  await t.as(
    OWNER,
    `insert into public.project_versions(project_id,schema_version,engine_version,design,design_hash) values($1,2,'0.1.0',$2::jsonb,$3)`,
    [project, DESIGN, HASH],
  );
  for (const [id, role] of [
    [ADMIN, "admin"],
    [MEMBER, "member"],
    [VIEWER, "viewer"],
  ])
    await t.as(
      "service",
      `insert into public.project_members(project_id,user_id,role) values($1,$2,$3::public.project_role)`,
      [project, id, role],
    );
});
afterAll(async () => {
  await t.close();
});

describe("durable work orders", () => {
  it("allows owners/admins to offer to editors and sets identity, time, revision and status on the server", async () => {
    for (const user of [OWNER, ADMIN]) {
      const row = await create(user);
      expect(parseWorkOrder(row)).toMatchObject({
        projectId: project,
        createdBy: user,
        assignedTo: MEMBER,
        status: "offered",
        targetComponentId: "a",
        completedAt: null,
      });
      expect(row["target_version_id"]).toBeTypeOf("string");
    }
  });
  it("denies assignment by members, viewers, outsiders and anonymous callers", async () => {
    for (const user of [MEMBER, VIEWER, OTHER])
      await expect(create(user)).rejects.toThrow(/cannot assign/i);
    await expect(
      t.as(null, `select public.create_work_order($1,$2,'a','build','A','','normal')`, [
        project,
        MEMBER,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
  it("validates membership and the actual latest saved target instead of trusting UI ids", async () => {
    for (const user of [VIEWER, OTHER])
      await expect(create(OWNER, user)).rejects.toThrow(/editor in this project/i);
    await expect(create(OWNER, MEMBER, "unsaved-part")).rejects.toThrow(/save the target/i);
    await expect(
      create(OWNER, MEMBER, "a", "ffffffff-ffff-ffff-ffff-ffffffffffff"),
    ).rejects.toThrow(/cannot assign/i);
  });
  it("allows all project members to read durable records, but no outsiders/anonymous readers", async () => {
    for (const user of [OWNER, ADMIN, MEMBER, VIEWER])
      expect(
        (await t.as(user, `select * from public.work_orders where project_id=$1`, [project]))
          .length,
      ).toBeGreaterThan(0);
    expect(
      await t.as(OTHER, `select * from public.work_orders where project_id=$1`, [project]),
    ).toEqual([]);
    await expect(t.as(null, `select * from public.work_orders`)).rejects.toThrow(
      /permission denied/i,
    );
  });
  it("forbids direct writes, including forged author, assignee, project and completion fields", async () => {
    const row = await create();
    for (const user of [OWNER, ADMIN, MEMBER, VIEWER, OTHER]) {
      await expect(
        t.as(
          user,
          `update public.work_orders set status='completed',completed_at=now(),assigned_to=$2 where id=$1`,
          [row["id"], OTHER],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        t.as(user, `delete from public.work_orders where id=$1`, [row["id"]]),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        t.as(
          user,
          `insert into public.work_orders(project_id,created_by,assigned_to,target_component_id,task_type,title) values($1,$2,$2,'a','build','Forged')`,
          [project, OWNER],
        ),
      ).rejects.toThrow(/permission denied/i);
    }
  });
  it("lets only the assignee accept/start/complete; managers may cancel but never impersonate progress", async () => {
    const row = await create();
    for (const user of [OWNER, ADMIN, VIEWER, OTHER])
      await expect(transition(user, row["id"], "offered", "accepted")).rejects.toThrow(
        /cannot update|not found/i,
      );
    await transition(MEMBER, row["id"], "offered", "accepted");
    await transition(MEMBER, row["id"], "accepted", "in_progress");
    await transition(MEMBER, row["id"], "in_progress", "blocked");
    await transition(MEMBER, row["id"], "blocked", "in_progress");
    const done = await transition(MEMBER, row["id"], "in_progress", "completed");
    expect(parseWorkOrder(done)).toMatchObject({
      status: "completed",
      completedAt: expect.any(String),
    });
    const separate = await create();
    await transition(ADMIN, separate["id"], "offered", "cancelled");
    expect(
      (
        await t.as(MEMBER, `select status from public.work_orders where id=$1`, [separate["id"]])
      )[0],
    ).toEqual({ status: "cancelled" });
  });
  it("rejects stale and null transitions without overwriting another user's result", async () => {
    const row = await create();
    await transition(MEMBER, row["id"], "offered", "accepted");
    await expect(transition(MEMBER, row["id"], "offered", "cancelled")).rejects.toThrow(/changed/i);
    await expect(transition(MEMBER, row["id"], null, "in_progress")).rejects.toThrow(/changed/i);
    await expect(transition(MEMBER, row["id"], "accepted", null)).rejects.toThrow(/not valid/i);
    await expect(transition(OTHER, row["id"], "accepted", "in_progress")).rejects.toThrow(
      /not found/i,
    );
  });
  it("enforces exactly the shared lifecycle for every pair of statuses", async () => {
    const row = await create();
    for (const from of Object.keys(WORK_TRANSITIONS) as WorkStatus[]) {
      for (const to of Object.keys(WORK_TRANSITIONS) as WorkStatus[]) {
        await t.as(
          "service",
          `update public.work_orders set status=$2,completed_at=case when $2='completed' then now() end where id=$1`,
          [row["id"], from],
        );
        if (WORK_TRANSITIONS[from].includes(to))
          expect((await transition(MEMBER, row["id"], from, to))["status"]).toBe(to);
        else await expect(transition(MEMBER, row["id"], from, to)).rejects.toThrow(/not valid/i);
      }
    }
  });
  it("retains assignments when a member leaves while rejecting further edits", async () => {
    const row = await create(OWNER, ADMIN);
    await t.as("service", `delete from public.project_members where project_id=$1 and user_id=$2`, [
      project,
      ADMIN,
    ]);
    expect(
      (
        await t.as(MEMBER, `select assigned_to from public.work_orders where id=$1`, [row["id"]])
      )[0],
    ).toEqual({ assigned_to: ADMIN });
    await expect(transition(ADMIN, row["id"], "offered", "accepted")).rejects.toThrow(/not found/i);
    await transition(OWNER, row["id"], "offered", "cancelled");
    await t.as(
      "service",
      `insert into public.project_members(project_id,user_id,role) values($1,$2,'admin')`,
      [project, ADMIN],
    );
  });
  it("rejects a viewer even if an earlier role allowed accepting work", async () => {
    const row = await create();
    await t.as(
      "service",
      `update public.project_members set role='viewer' where project_id=$1 and user_id=$2`,
      [project, MEMBER],
    );
    await expect(transition(MEMBER, row["id"], "offered", "accepted")).rejects.toThrow(
      /cannot update/i,
    );
    await t.as(
      "service",
      `update public.project_members set role='member' where project_id=$1 and user_id=$2`,
      [project, MEMBER],
    );
  });
  it("enforces field bounds and emits database invalidations and an audit trail", async () => {
    for (const [type, title, priority] of [
      ["fake", "Good", "normal"],
      ["build", " ", "normal"],
      ["build", "A".repeat(121), "normal"],
      ["build", "Good", "urgent"],
    ])
      await expect(
        t.as(OWNER, `select public.create_work_order($1,$2,'a',$3,$4,'',$5)`, [
          project,
          MEMBER,
          type,
          title,
          priority,
        ]),
      ).rejects.toThrow(/check constraint/i);
    const row = await create();
    const sent = await t.as<{ topic: string; event: string; payload: unknown; private: boolean }>(
      "service",
      `select topic,event,payload,private from realtime.sent where topic=$1 order by id desc limit 1`,
      [`work:${project}`],
    );
    expect(sent[0]).toEqual({
      topic: `work:${project}`,
      event: "work.changed",
      payload: { project_id: project },
      private: true,
    });
    const audit = await t.as(
      OWNER,
      `select action from public.audit_events where details->>'work_order_id'=$1`,
      [row["id"]],
    );
    expect(audit).toEqual([{ action: "work.offered" }]);
  });
  it("authorizes the private work topic for project readers but never browser publishers", async () => {
    await t.db.query(`select set_config('realtime.topic',$1,false)`, [`work:${project}`]);
    await t.as("service", `insert into realtime.messages(topic,extension) values($1,'broadcast')`, [
      `work:${project}`,
    ]);
    for (const user of [OWNER, ADMIN, MEMBER, VIEWER]) {
      expect(
        (await t.as(user, `select * from realtime.messages where topic=$1`, [`work:${project}`]))
          .length,
      ).toBeGreaterThan(0);
      await expect(
        t.as(user, `insert into realtime.messages(topic,extension) values($1,'broadcast')`, [
          `work:${project}`,
        ]),
      ).rejects.toThrow(/row-level security/i);
    }
    expect(
      await t.as(OTHER, `select * from realtime.messages where topic=$1`, [`work:${project}`]),
    ).toEqual([]);
    await t.db.query(`select set_config('realtime.topic','',false)`);
  });
  it("bounds assignment rate and active work, and cascades a deleted project's history", async () => {
    const extra = (
      await t.as<{ id: string }>(
        OWNER,
        `insert into public.projects(name,slug) values('Budget test','work-budget') returning id`,
      )
    )[0]!.id;
    await t.as(
      OWNER,
      `insert into public.project_versions(project_id,schema_version,engine_version,design,design_hash) values($1,2,'0.1.0',$2::jsonb,$3)`,
      [extra, DESIGN, HASH],
    );
    await t.as(
      "service",
      `insert into public.work_orders(project_id,created_by,assigned_to,target_component_id,task_type,title) select $1,$2,$2,'a','inspect','Budget task' from generate_series(1,20)`,
      [extra, OWNER],
    );
    await expect(create(OWNER, OWNER, "a", extra)).rejects.toThrow(/too quickly/i);
    await t.as(
      "service",
      `update public.work_orders set created_at=now()-interval '2 minutes' where project_id=$1`,
      [extra],
    );
    await t.as(
      "service",
      `insert into public.work_orders(project_id,created_by,assigned_to,target_component_id,task_type,title) select $1,$2,$2,'a','inspect','Budget task' from generate_series(1,180)`,
      [extra, OWNER],
    );
    await expect(create(OWNER, OWNER, "a", extra)).rejects.toThrow(/200 active/i);
    await t.as("service", `delete from public.projects where id=$1`, [extra]);
    expect(
      await t.as("service", `select id from public.work_orders where project_id=$1`, [extra]),
    ).toEqual([]);
  });
});
