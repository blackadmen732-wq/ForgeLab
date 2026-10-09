import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIMITS, PROJECT_ROLES, ROLE_PERMISSIONS } from "@forgelab/protocol";
import { DESIGN, HASH, createTestDatabase, type TestDatabase } from "./harness.js";

/**
 * Security tests for collaboration: membership, invites, channels, messages, Realtime
 * topic authorization, save conflicts and the audit trail. Each test acts as a specific
 * user, anonymously, or as the service role, against the migrations applied unchanged.
 */
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const ADMIN = "00000000-0000-4000-8000-0000000000a2";
const MEMBER = "00000000-0000-4000-8000-0000000000a3";
const VIEWER = "00000000-0000-4000-8000-0000000000a4";
const STRANGER = "00000000-0000-4000-8000-0000000000a5";

let t: TestDatabase;
let project: string;
let general: string;

async function expectDenied(
  promise: Promise<unknown>,
  pattern: RegExp = /permission denied|row-level security|violates|cannot|not found|not valid/i,
) {
  await expect(promise).rejects.toThrow(pattern);
}

async function invite(as: string, role: string, projectId = project): Promise<string> {
  const [row] = await t.as<{ code: string }>(
    as,
    `select public.create_invite($1, $2::public.project_role, 24, 5) as code`,
    [projectId, role],
  );
  return row!.code;
}

async function join(user: string, code: string) {
  await t.as(user, `select public.accept_invite($1)`, [code]);
}

async function latestVersion(projectId: string): Promise<string | null> {
  const [row] = await t.as<{ id: string | null }>(
    "service",
    `select latest_version_id as id from public.projects where id = $1`,
    [projectId],
  );
  return row?.id ?? null;
}

async function save(user: string, parent: string | null, projectId = project) {
  return t.as<{ id: string }>(
    user,
    `insert into public.project_versions (project_id, schema_version, engine_version, design, design_hash, is_autosave, parent_version_id)
     values ($1, 2, '0.1.0', $2::jsonb, $3, true, $4) returning id`,
    [projectId, DESIGN, HASH, parent],
  );
}

/** Evaluates the Realtime RLS policies the way the Realtime server does for a topic. */
async function realtimeAllows(
  user: string,
  topic: string,
  op: "select" | "insert",
  extension = "presence",
): Promise<boolean> {
  await t.db.exec("reset role");
  await t.db.query(`select set_config('realtime.topic', $1, false)`, [topic]);
  try {
    if (op === "insert") {
      await t.as(
        user,
        `insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}'::jsonb)`,
        [topic, extension],
      );
      return true;
    }
    await t.as(
      "service",
      `insert into realtime.messages (topic, extension, payload) values ($1, $2, '{}'::jsonb)`,
      [topic, extension],
    );
    const rows = await t.as<{ n: number }>(
      user,
      `select count(*)::int as n from realtime.messages where topic = $1`,
      [topic],
    );
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    return false;
  } finally {
    await t.db.exec("reset role");
    await t.db.query(`select set_config('realtime.topic', '', false)`);
  }
}

beforeAll(async () => {
  t = await createTestDatabase();
  await t.signUp(OWNER, "owner@example.com", { username: "owner" });
  await t.signUp(ADMIN, "admin@example.com", { username: "admin" });
  await t.signUp(MEMBER, "member@example.com", { username: "member" });
  await t.signUp(VIEWER, "viewer@example.com", { username: "viewer" });
  await t.signUp(STRANGER, "stranger@example.com", { username: "stranger" });
  const [row] = await t.as<{ id: string }>(
    OWNER,
    `insert into public.projects (name, slug) values ('Helios Reactor', 'helios') returning id`,
  );
  project = row!.id;
  await save(OWNER, null);
  await join(ADMIN, await invite(OWNER, "admin"));
  await join(MEMBER, await invite(OWNER, "member"));
  await join(VIEWER, await invite(OWNER, "viewer"));
  const [g] = await t.as<{ id: string }>(
    OWNER,
    `select id from public.channels where project_id = $1 and name = 'General'`,
    [project],
  );
  general = g!.id;
});

afterAll(async () => {
  await t.close();
});

describe("membership", () => {
  it("makes the creator the owner and opens a General channel", async () => {
    const rows = await t.as<{ user_id: string; role: string }>(
      OWNER,
      `select user_id, role from public.project_members where project_id = $1 order by joined_at`,
      [project],
    );
    expect(rows.map((r) => [r.user_id, r.role])).toEqual([
      [OWNER, "owner"],
      [ADMIN, "admin"],
      [MEMBER, "member"],
      [VIEWER, "viewer"],
    ]);
    expect(general).toBeDefined();
  });

  it("lets members see the private project and its versions, and nobody else", async () => {
    for (const user of [ADMIN, MEMBER, VIEWER]) {
      expect(
        await t.as(user, `select id from public.projects where id = $1`, [project]),
      ).toHaveLength(1);
      expect(
        (
          await t.as(user, `select id from public.project_versions where project_id = $1`, [
            project,
          ])
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(
      await t.as(STRANGER, `select id from public.projects where id = $1`, [project]),
    ).toHaveLength(0);
    expect(
      await t.as(STRANGER, `select * from public.project_members where project_id = $1`, [project]),
    ).toHaveLength(0);
    await expectDenied(
      t.as(null, `select * from public.project_members where project_id = $1`, [project]),
    );
  });

  it("never lets clients write membership rows directly", async () => {
    await expectDenied(
      t.as(
        STRANGER,
        `insert into public.project_members (project_id, user_id, role) values ($1, $2, 'owner')`,
        [project, STRANGER],
      ),
    );
    await expectDenied(
      t.as(MEMBER, `update public.project_members set role = 'owner' where user_id = $1`, [MEMBER]),
    );
    await expectDenied(
      t.as(ADMIN, `delete from public.project_members where user_id = $1`, [MEMBER]),
    );
  });
});

describe("permission matrix", () => {
  it("is identical in SQL and in @forgelab/protocol", async () => {
    for (const role of PROJECT_ROLES) {
      const [row] = await t.as<{ perms: string[] }>(
        OWNER,
        `select public.role_permissions($1::public.project_role) as perms`,
        [role],
      );
      expect(row!.perms, role).toEqual([...ROLE_PERMISSIONS[role]]);
    }
  });

  it("reports each caller's own permissions for a channel, and none to strangers", async () => {
    const perms = async (user: string) =>
      (
        await t.as<{ p: string[] }>(user, `select public.channel_permissions($1) as p`, [general])
      )[0]!.p;
    expect(await perms(MEMBER)).toContain("can_send_messages");
    expect(await perms(VIEWER)).toEqual(["can_view", "can_join_voice"]);
    expect(await perms(STRANGER)).toEqual([]);
    const [access] = await t.as<{ a: { project_id: string } | null }>(
      STRANGER,
      `select public.channel_access($1) as a`,
      [general],
    );
    expect(access!.a).toBeNull();
  });
});

describe("invites", () => {
  it("stores only a hash of the code and hides it from clients", async () => {
    const code = await invite(OWNER, "member");
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    const [stored] = await t.as<{ code_hash: string }>(
      "service",
      `select code_hash from public.project_invites order by created_at desc limit 1`,
    );
    expect(stored!.code_hash).not.toBe(code);
    await expectDenied(t.as(OWNER, `select code_hash from public.project_invites`));
  });

  it("enforces who may invite whom", async () => {
    await expectDenied(invite(MEMBER, "member"));
    await expectDenied(invite(VIEWER, "viewer"));
    await expectDenied(invite(ADMIN, "admin"));
    await expectDenied(invite(OWNER, "owner"));
    await expectDenied(invite(STRANGER, "member"));
    expect(await invite(ADMIN, "viewer")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never changes an existing role through an invite, and rejects bad or used codes", async () => {
    await join(VIEWER, await invite(OWNER, "admin"));
    const [row] = await t.as<{ role: string }>(
      VIEWER,
      `select role from public.project_members where project_id = $1 and user_id = $2`,
      [project, VIEWER],
    );
    expect(row!.role).toBe("viewer");
    await expectDenied(join(STRANGER, "f".repeat(64)));
    await expectDenied(join(STRANGER, "not-a-code"));
    await expectDenied(join(null as unknown as string, await invite(OWNER, "member")));
  });

  it("stops working when revoked", async () => {
    const code = await invite(OWNER, "member");
    const [inv] = await t.as<{ id: string }>(
      OWNER,
      `select id from public.project_invites order by created_at desc limit 1`,
    );
    await t.as(OWNER, `select public.revoke_invite($1)`, [inv!.id]);
    await expectDenied(join(STRANGER, code));
  });
});

describe("channels", () => {
  it("lets owners and admins manage channels; members and viewers cannot", async () => {
    const [c] = await t.as<{ id: string }>(
      ADMIN,
      `select public.create_channel($1, 'Magnet Team') as id`,
      [project],
    );
    expect(c!.id).toBeDefined();
    await expectDenied(t.as(MEMBER, `select public.create_channel($1, 'Rogue')`, [project]));
    await expectDenied(t.as(VIEWER, `select public.create_channel($1, 'Rogue')`, [project]));
    await expectDenied(
      t.as(ADMIN, `select public.create_channel($1, 'magnet team')`, [project]),
      /duplicate|unique/i,
    );
    await expectDenied(
      t.as(ADMIN, `select public.create_channel($1, $2)`, [project, "x".repeat(41)]),
      /check/i,
    );
    await expectDenied(
      t.as(MEMBER, `insert into public.channels (project_id, name) values ($1, 'Direct')`, [
        project,
      ]),
    );
    await expectDenied(t.as(MEMBER, `select public.rename_channel($1, 'Hijacked')`, [c!.id]));
    await t.as(ADMIN, `select public.rename_channel($1, 'Magnets')`, [c!.id]);
    await t.as(ADMIN, `select public.delete_channel($1)`, [c!.id]);
  });

  it("hides private channels from members who are not on the list", async () => {
    const [c] = await t.as<{ id: string }>(
      OWNER,
      `select public.create_channel($1, 'Private Room', true) as id`,
      [project],
    );
    expect(
      await t.as(MEMBER, `select id from public.channels where id = $1`, [c!.id]),
    ).toHaveLength(0);
    expect(await t.as(ADMIN, `select id from public.channels where id = $1`, [c!.id])).toHaveLength(
      1,
    );
    await t.as(
      "service",
      `insert into public.channel_members (channel_id, user_id) values ($1, $2)`,
      [c!.id, MEMBER],
    );
    expect(
      await t.as(MEMBER, `select id from public.channels where id = $1`, [c!.id]),
    ).toHaveLength(1);
  });

  it("refuses to delete the last channel", async () => {
    const [p] = await t.as<{ id: string }>(
      OWNER,
      `insert into public.projects (name, slug) values ('Solo', 'solo') returning id`,
    );
    const [only] = await t.as<{ id: string }>(
      OWNER,
      `select id from public.channels where project_id = $1`,
      [p!.id],
    );
    await expectDenied(t.as(OWNER, `select public.delete_channel($1)`, [only!.id]), /at least one/);
  });
});

describe("messages", () => {
  it("takes identity and project from the server, not the client", async () => {
    const [m] = await t.as<{ user_id: string; project_id: string }>(
      MEMBER,
      `insert into public.messages (channel_id, content) values ($1, 'I''m changing the outer coils.') returning user_id, project_id`,
      [general],
    );
    expect(m).toEqual({ user_id: MEMBER, project_id: project });
    await expectDenied(
      t.as(
        MEMBER,
        `insert into public.messages (channel_id, content, user_id) values ($1, 'spoof', $2)`,
        [general, OWNER],
      ),
    );
    await expectDenied(
      t.as(
        MEMBER,
        `insert into public.messages (channel_id, content, project_id) values ($1, 'spoof', $2)`,
        [general, project],
      ),
    );
  });

  it("delivers each message to the channel's private chat topic", async () => {
    await t.as(
      ADMIN,
      `insert into public.messages (channel_id, content) values ($1, 'Don''t run it yet.')`,
      [general],
    );
    const [sent] = await t.as<{ topic: string; private: boolean; payload: { content: string } }>(
      "service",
      `select topic, private, payload from realtime.sent order by id desc limit 1`,
    );
    expect(sent).toMatchObject({
      topic: `chat:${general}`,
      private: true,
      payload: { content: "Don't run it yet." },
    });
  });

  it("lets viewers read but not send, and strangers do neither", async () => {
    expect(
      (await t.as(VIEWER, `select id from public.messages where channel_id = $1`, [general]))
        .length,
    ).toBeGreaterThan(0);
    await expectDenied(
      t.as(VIEWER, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [
        general,
      ]),
    );
    expect(
      await t.as(STRANGER, `select id from public.messages where channel_id = $1`, [general]),
    ).toHaveLength(0);
    await expectDenied(
      t.as(STRANGER, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [
        general,
      ]),
    );
    await expectDenied(
      t.as(null, `insert into public.messages (channel_id, content) values ($1, 'hi')`, [general]),
    );
  });

  it("enforces content rules and the rate limit", async () => {
    await expectDenied(
      t.as(ADMIN, `insert into public.messages (channel_id, content) values ($1, $2)`, [
        general,
        "x".repeat(LIMITS.messageMaxChars + 1),
      ]),
      /check/i,
    );
    await expectDenied(
      t.as(ADMIN, `insert into public.messages (channel_id, content) values ($1, $2)`, [
        general,
        "bell\u0007",
      ]),
      /check/i,
    );
    await expectDenied(
      t.as(ADMIN, `insert into public.messages (channel_id, content) values ($1, '  padded  ')`, [
        general,
      ]),
      /check/i,
    );
    const sent: Promise<unknown>[] = [];
    for (let i = 0; i < LIMITS.messageRateCount; i += 1) {
      sent.push(
        t
          .as(OWNER, `insert into public.messages (channel_id, content) values ($1, $2)`, [
            general,
            `status ${i}`,
          ])
          .catch((e: Error) => e),
      );
    }
    const results = [];
    for (const p of sent) results.push(await p);
    await expectDenied(
      t.as(OWNER, `insert into public.messages (channel_id, content) values ($1, 'one too many')`, [
        general,
      ]),
      /rate_limited/,
    );
  });
});

describe("realtime authorization", () => {
  it("admits project members to presence and events on their project topic only", async () => {
    const topic = `project:${project}`;
    expect(await realtimeAllows(MEMBER, topic, "select")).toBe(true);
    expect(await realtimeAllows(VIEWER, topic, "insert", "presence")).toBe(true);
    expect(await realtimeAllows(MEMBER, topic, "insert", "broadcast")).toBe(true);
    expect(await realtimeAllows(STRANGER, topic, "select")).toBe(false);
    expect(await realtimeAllows(STRANGER, topic, "insert")).toBe(false);
    expect(await realtimeAllows(null as unknown as string, topic, "select")).toBe(false);
  });

  it("lets channel viewers receive chat but nobody publish to it", async () => {
    const topic = `chat:${general}`;
    expect(await realtimeAllows(VIEWER, topic, "select", "broadcast")).toBe(true);
    expect(await realtimeAllows(STRANGER, topic, "select", "broadcast")).toBe(false);
    expect(await realtimeAllows(OWNER, topic, "insert", "broadcast")).toBe(false);
  });

  it("rejects malformed and foreign topics", async () => {
    expect(await realtimeAllows(MEMBER, `project:${project}x`, "select")).toBe(false);
    expect(await realtimeAllows(MEMBER, "project:*", "select")).toBe(false);
    expect(await realtimeAllows(MEMBER, `chat:${project}`, "select", "broadcast")).toBe(false);
    expect(await realtimeAllows(MEMBER, `other:${project}`, "select")).toBe(false);
  });
});

describe("shared saves", () => {
  it("lets editors save on top of the latest version and rejects stale saves", async () => {
    const base = await latestVersion(project);
    await save(MEMBER, base);
    await expectDenied(save(ADMIN, base), /stale_version/);
    await expectDenied(save(ADMIN, null), /stale_version/);
    await save(ADMIN, await latestVersion(project));
  });

  it("refuses saves from viewers and strangers", async () => {
    const base = await latestVersion(project);
    await expectDenied(save(VIEWER, base));
    await expectDenied(save(STRANGER, base));
  });
});

describe("roles, removal and audit", () => {
  it("applies the rank rules for role changes and removal", async () => {
    await expectDenied(
      t.as(ADMIN, `select public.set_member_role($1, $2, 'admin')`, [project, MEMBER]),
    );
    await expectDenied(
      t.as(MEMBER, `select public.set_member_role($1, $2, 'member')`, [project, VIEWER]),
    );
    await expectDenied(t.as(ADMIN, `select public.remove_member($1, $2)`, [project, OWNER]));
    await expectDenied(
      t.as(OWNER, `select public.set_member_role($1, $2, 'viewer')`, [project, OWNER]),
    );
    await t.as(ADMIN, `select public.set_member_role($1, $2, 'member')`, [project, VIEWER]);
    await t.as(OWNER, `select public.set_member_role($1, $2, 'viewer')`, [project, VIEWER]);
  });

  it("removes access immediately when a member leaves or is removed", async () => {
    await t.as(VIEWER, `select public.remove_member($1, $2)`, [project, VIEWER]);
    expect(
      await t.as(VIEWER, `select id from public.projects where id = $1`, [project]),
    ).toHaveLength(0);
    expect(
      await t.as(VIEWER, `select id from public.messages where channel_id = $1`, [general]),
    ).toHaveLength(0);
    expect(await realtimeAllows(VIEWER, `project:${project}`, "select")).toBe(false);
  });

  it("records administrative actions, readable by owners and admins only", async () => {
    const rows = await t.as<{ action: string }>(
      ADMIN,
      `select action from public.audit_events where project_id = $1`,
      [project],
    );
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "member.added",
      "member.role_changed",
      "member.removed",
      "invite.created",
      "invite.revoked",
      "channel.created",
      "channel.deleted",
    ]) {
      expect(actions.has(a), a).toBe(true);
    }
    expect(
      await t.as(MEMBER, `select id from public.audit_events where project_id = $1`, [project]),
    ).toHaveLength(0);
    await expectDenied(
      t.as(OWNER, `insert into public.audit_events (project_id, action) values ($1, 'forged')`, [
        project,
      ]),
    );
  });

  it("keeps the rate limiter server-only", async () => {
    await expectDenied(t.as(MEMBER, `select public.consume_rate($1, 'voice', 10, 60)`, [MEMBER]));
    const [ok] = await t.as<{ ok: boolean }>(
      "service",
      `select public.consume_rate($1, 'voice', 1, 60) as ok`,
      [MEMBER],
    );
    const [again] = await t.as<{ ok: boolean }>(
      "service",
      `select public.consume_rate($1, 'voice', 1, 60) as ok`,
      [MEMBER],
    );
    expect([ok!.ok, again!.ok]).toEqual([true, false]);
  });
});
