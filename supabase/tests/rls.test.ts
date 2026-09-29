import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEADERBOARD_CATEGORIES } from "@forgelab/sim-runner";
import { DESIGN, HASH, createTestDatabase, type TestDatabase } from "./harness.js";

/**
 * Security tests for ForgeLab's Supabase schema, run against real Postgres (PGlite) with
 * the migrations applied unchanged. Each test acts as a specific user, anonymously, or as
 * the service role, and checks what the database allows.
 */
const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const CAROL = "00000000-0000-4000-8000-00000000000c";

let t: TestDatabase;

async function newProject(owner: string, name: string, visibility = "private"): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const [row] = await t.as<{ id: string }>(
    owner,
    `insert into public.projects (name, slug, visibility) values ($1, $2, $3) returning id`,
    [name, slug, visibility],
  );
  return row!.id;
}

async function saveVersion(
  owner: string,
  projectId: string,
  autosave = true,
  label: string | null = null,
) {
  // Saves name the version they build on (conflict protection, see the collaboration migration).
  const [latest] = await t.as<{ latest_version_id: string | null }>(
    "service",
    `select latest_version_id from public.projects where id = $1`,
    [projectId],
  );
  const [row] = await t.as<{ id: string; version_number: number }>(
    owner,
    `insert into public.project_versions (project_id, schema_version, engine_version, design, design_hash, is_autosave, label, parent_version_id)
     values ($1, 2, '0.1.0', $2::jsonb, $3, $4, $5, $6) returning id, version_number`,
    [projectId, DESIGN, HASH, autosave, label, latest?.latest_version_id ?? null],
  );
  return row!;
}

async function expectDenied(
  promise: Promise<unknown>,
  pattern: RegExp = /permission denied|row-level security|violates/,
) {
  await expect(promise).rejects.toThrow(pattern);
}

beforeAll(async () => {
  t = await createTestDatabase();
  await t.signUp(ALICE, "alice@example.com", { username: "Alice!" });
  await t.signUp(BOB, "bob@example.com");
  await t.signUp(CAROL, "alice@elsewhere.com");
}, 60000);

afterAll(async () => {
  await t.close();
});

describe("profiles", () => {
  it("creates a valid, unique username for every new user", async () => {
    const rows = await t.as<{ id: string; username: string }>(
      null,
      `select id, username from public.profiles order by username`,
    );
    const byId = new Map(rows.map((r) => [r.id, r.username]));
    expect(byId.get(ALICE)).toBe("alice");
    expect(byId.get(BOB)).toBe("bob");
    // Carol's email local part collides with Alice's username.
    expect(byId.get(CAROL)).toBe("alice1");
  });

  it("lets users edit only their own profile, within the username rules", async () => {
    await t.as(BOB, `update public.profiles set display_name = 'Bob the Builder' where id = $1`, [
      BOB,
    ]);
    const updated = await t.as(
      ALICE,
      `update public.profiles set display_name = 'hacked' where id = $1 returning id`,
      [BOB],
    );
    expect(updated).toEqual([]);
    await expectDenied(
      t.as(BOB, `update public.profiles set username = 'Not Valid!' where id = $1`, [BOB]),
      /check constraint/,
    );
    await expectDenied(t.as(BOB, `update public.profiles set id = $2 where id = $1`, [BOB, ALICE]));
    const [bob] = await t.as<{ display_name: string }>(
      null,
      `select display_name from public.profiles where id = $1`,
      [BOB],
    );
    expect(bob!.display_name).toBe("Bob the Builder");
  });
});

describe("projects and versions", () => {
  let privateId: string;
  let publicId: string;

  beforeAll(async () => {
    privateId = await newProject(ALICE, "Secret Reactor");
    publicId = await newProject(ALICE, "Open Reactor");
  });

  it("assigns the owner from the session and refuses client-set owners and counters", async () => {
    const [row] = await t.as<{ owner_id: string }>(
      ALICE,
      `select owner_id from public.projects where id = $1`,
      [privateId],
    );
    expect(row!.owner_id).toBe(ALICE);
    await expectDenied(
      t.as(BOB, `insert into public.projects (owner_id, name, slug) values ($1, 'x', 'x')`, [
        ALICE,
      ]),
    );
    await expectDenied(
      t.as(ALICE, `update public.projects set like_count = 9999 where id = $1`, [publicId]),
    );
    await expectDenied(
      t.as(ALICE, `update public.projects set latest_version_id = null where id = $1`, [publicId]),
    );
    await expectDenied(
      t.as(null, `insert into public.projects (name, slug) values ('anon', 'anon')`),
    );
  });

  it("numbers versions in the database and points the project at the newest", async () => {
    const v1 = await saveVersion(ALICE, privateId);
    const v2 = await saveVersion(ALICE, privateId);
    expect([v1.version_number, v2.version_number]).toEqual([1, 2]);
    await expectDenied(
      t.as(
        ALICE,
        `insert into public.project_versions (project_id, version_number, schema_version, engine_version, design, design_hash)
         values ($1, 99, 2, '0.1.0', $2::jsonb, $3)`,
        [privateId, DESIGN, HASH],
      ),
    );
    const [project] = await t.as<{
      latest_version_id: string;
      latest_version_number: number;
      component_count: number;
    }>(
      ALICE,
      `select latest_version_id, latest_version_number, component_count from public.projects where id = $1`,
      [privateId],
    );
    expect(project).toEqual({
      latest_version_id: v2.id,
      latest_version_number: 2,
      component_count: 2,
    });
  });

  it("keeps versions immutable", async () => {
    await expectDenied(
      t.as(ALICE, `update public.project_versions set label = 'edited' where project_id = $1`, [
        privateId,
      ]),
    );
    await expectDenied(
      t.as(ALICE, `delete from public.project_versions where project_id = $1`, [privateId]),
    );
  });

  it("hides a private project and its versions from everyone but the owner", async () => {
    expect(await t.as(BOB, `select id from public.projects where id = $1`, [privateId])).toEqual(
      [],
    );
    expect(await t.as(null, `select id from public.projects where id = $1`, [privateId])).toEqual(
      [],
    );
    expect(
      await t.as(BOB, `select id from public.project_versions where project_id = $1`, [privateId]),
    ).toEqual([]);
    expect(
      await t.as(ALICE, `select id from public.project_versions where project_id = $1`, [
        privateId,
      ]),
    ).toHaveLength(2);
  });

  it("never lets another user edit, delete or add versions to someone else's project", async () => {
    expect(
      await t.as(BOB, `update public.projects set name = 'mine now' where id = $1 returning id`, [
        privateId,
      ]),
    ).toEqual([]);
    expect(
      await t.as(BOB, `delete from public.projects where id = $1 returning id`, [privateId]),
    ).toEqual([]);
    await expectDenied(saveVersion(BOB, privateId));
    await expectDenied(saveVersion(BOB, publicId));
  });

  it("publishes: stamps the date and exposes only the latest and named versions", async () => {
    await saveVersion(ALICE, publicId, true);
    const named = await saveVersion(ALICE, publicId, false, "Milestone");
    const latest = await saveVersion(ALICE, publicId, true);
    await t.as(ALICE, `update public.projects set visibility = 'public' where id = $1`, [publicId]);

    const [project] = await t.as<{ published_at: string | null }>(
      null,
      `select published_at from public.projects where id = $1`,
      [publicId],
    );
    expect(project!.published_at).not.toBeNull();

    const visible = await t.as<{ id: string }>(
      null,
      `select id from public.project_versions where project_id = $1 order by version_number`,
      [publicId],
    );
    expect(visible.map((v) => v.id).sort()).toEqual([named.id, latest.id].sort());
    const owner = await t.as(
      ALICE,
      `select id from public.project_versions where project_id = $1`,
      [publicId],
    );
    expect(owner).toHaveLength(3);
  });

  it("bounds autosave history but keeps named versions", async () => {
    const id = await newProject(ALICE, "Autosave Soak");
    await saveVersion(ALICE, id, false, "keep me");
    for (let i = 0; i < 55; i += 1) await saveVersion(ALICE, id, true);
    const rows = await t.as<{ is_autosave: boolean }>(
      ALICE,
      `select is_autosave from public.project_versions where project_id = $1`,
      [id],
    );
    expect(rows.filter((r) => r.is_autosave)).toHaveLength(50);
    expect(rows.filter((r) => !r.is_autosave)).toHaveLength(1);
  });

  it("lets an owner delete a project, cascading its versions", async () => {
    const id = await newProject(ALICE, "Doomed");
    await saveVersion(ALICE, id);
    expect(
      await t.as(ALICE, `delete from public.projects where id = $1 returning id`, [id]),
    ).toHaveLength(1);
    expect(
      await t.as("service", `select id from public.project_versions where project_id = $1`, [id]),
    ).toEqual([]);
  });
});

describe("forking", () => {
  let source: string;
  let privateSource: string;

  beforeAll(async () => {
    source = await newProject(ALICE, "Forkable Plant", "public");
    await saveVersion(ALICE, source, false, "v1");
    privateSource = await newProject(ALICE, "Private Plant");
    await saveVersion(ALICE, privateSource);
  });

  it("creates a private copy owned by the forker and records the lineage", async () => {
    const [{ fork_project: childId }] = (await t.as<{ fork_project: string }>(
      BOB,
      `select public.fork_project($1)`,
      [source],
    )) as [{ fork_project: string }];
    const [child] = await t.as<Record<string, unknown>>(
      BOB,
      `select owner_id, visibility, forked_from_project_id, latest_version_number, name from public.projects where id = $1`,
      [childId],
    );
    expect(child).toMatchObject({
      owner_id: BOB,
      visibility: "private",
      forked_from_project_id: source,
      latest_version_number: 1,
      name: "Forkable Plant (fork)",
    });
    const [parent] = await t.as<{ fork_count: number }>(
      null,
      `select fork_count from public.projects where id = $1`,
      [source],
    );
    expect(parent!.fork_count).toBe(1);
    const lineage = await t.as(
      BOB,
      `select parent_project_id from public.project_forks where child_project_id = $1`,
      [childId],
    );
    expect(lineage).toEqual([{ parent_project_id: source }]);
    // The fork is Bob's and private: Alice cannot see it.
    expect(await t.as(ALICE, `select id from public.projects where id = $1`, [childId])).toEqual(
      [],
    );
  });

  it("refuses to fork a private project of someone else, and refuses anonymous forks", async () => {
    await expectDenied(t.as(BOB, `select public.fork_project($1)`, [privateSource]), /not found/);
    await expectDenied(t.as(null, `select public.fork_project($1)`, [source]), /permission denied/);
  });

  it("never lets clients write lineage directly", async () => {
    await expectDenied(
      t.as(BOB, `insert into public.project_forks (child_project_id, forked_by) values ($1, $2)`, [
        source,
        BOB,
      ]),
    );
  });
});

describe("likes", () => {
  let publicId: string;
  let privateId: string;

  beforeAll(async () => {
    publicId = await newProject(ALICE, "Likeable", "public");
    privateId = await newProject(ALICE, "Unlikeable");
  });

  it("counts a like, refuses a duplicate and uncounts on removal", async () => {
    await t.as(BOB, `insert into public.project_likes (project_id) values ($1)`, [publicId]);
    await expectDenied(
      t.as(BOB, `insert into public.project_likes (project_id) values ($1)`, [publicId]),
      /duplicate key/,
    );
    let [row] = await t.as<{ like_count: number }>(
      null,
      `select like_count from public.projects where id = $1`,
      [publicId],
    );
    expect(row!.like_count).toBe(1);
    await t.as(BOB, `delete from public.project_likes where project_id = $1`, [publicId]);
    [row] = await t.as<{ like_count: number }>(
      null,
      `select like_count from public.projects where id = $1`,
      [publicId],
    );
    expect(row!.like_count).toBe(0);
  });

  it("refuses likes on private projects and likes on someone else's behalf", async () => {
    await expectDenied(
      t.as(BOB, `insert into public.project_likes (project_id) values ($1)`, [privateId]),
    );
    await expectDenied(
      t.as(BOB, `insert into public.project_likes (user_id, project_id) values ($1, $2)`, [
        CAROL,
        publicId,
      ]),
    );
    await expectDenied(
      t.as(null, `insert into public.project_likes (project_id) values ($1)`, [publicId]),
    );
  });
});

describe("runs and verified leaderboards", () => {
  let projectId: string;
  let versionId: string;

  beforeAll(async () => {
    projectId = await newProject(ALICE, "Contender", "public");
    versionId = (await saveVersion(ALICE, projectId, false, "entry")).id;
  });

  it("lets users record unverified runs but never mark one verified", async () => {
    await t.as(
      ALICE,
      `insert into public.simulation_runs (project_id, version_id, engine_version, scenario_id, duration_sec)
       values ($1, $2, '0.1.0', 'local', 60)`,
      [projectId, versionId],
    );
    await expectDenied(
      t.as(
        ALICE,
        `insert into public.simulation_runs (project_id, version_id, engine_version, scenario_id, duration_sec, verified)
         values ($1, $2, '0.1.0', 'local', 60, true)`,
        [projectId, versionId],
      ),
    );
    await expectDenied(t.as(ALICE, `update public.simulation_runs set verified = true`));
    expect(await t.as(BOB, `select id from public.simulation_runs`)).toEqual([]);
  });

  it("never lets a browser write a leaderboard entry", async () => {
    const insert = `insert into public.leaderboard_entries
      (category, user_id, project_id, version_id, value, engine_version, protocol_version, scenario_id, design_hash, confidence)
      values ('net-electric', $1, $2, $3, 1e9, '0.1.0', 1, 'standard-600s', $4, 'approximate')`;
    await expectDenied(t.as(ALICE, insert, [ALICE, projectId, versionId, HASH]));
    await expectDenied(t.as(null, insert, [ALICE, projectId, versionId, HASH]));
  });

  it("ranks server-written entries best per user, in each category's direction", async () => {
    const bobProject = await newProject(BOB, "Bob's Plant", "public");
    const bobVersion = (await saveVersion(BOB, bobProject, false, "entry")).id;
    const write = (
      user: string,
      project: string,
      version: string,
      category: string,
      value: number,
      hash: string,
    ) =>
      t.as(
        "service",
        `insert into public.leaderboard_entries
         (category, user_id, project_id, version_id, value, engine_version, protocol_version, scenario_id, design_hash, confidence)
         values ($1, $2, $3, $4, $5, '0.1.0', 1, 'standard-600s', $6, 'approximate')`,
        [category, user, project, version, value, hash],
      );
    await write(ALICE, projectId, versionId, "net-electric", -80, "1".repeat(64));
    await write(ALICE, projectId, versionId, "net-electric", 40, "2".repeat(64));
    await write(BOB, bobProject, bobVersion, "net-electric", 25, "3".repeat(64));
    await write(ALICE, projectId, versionId, "lightest-net-positive", 30000, "2".repeat(64));
    await write(BOB, bobProject, bobVersion, "lightest-net-positive", 12000, "3".repeat(64));

    const net = await t.as<{ rank: number; username: string; value: number }>(
      null,
      `select rank, username, value from public.leaderboard('net-electric')`,
    );
    expect(net.map((r) => [Number(r.rank), r.username, r.value])).toEqual([
      [1, "alice", 40],
      [2, "bob", 25],
    ]);
    const light = await t.as<{ username: string }>(
      null,
      `select username from public.leaderboard('lightest-net-positive')`,
    );
    expect(light.map((r) => r.username)).toEqual(["bob", "alice"]);

    // Taking a project private removes its entries from public view.
    await t.as(BOB, `update public.projects set visibility = 'private' where id = $1`, [
      bobProject,
    ]);
    const after = await t.as<{ username: string }>(
      null,
      `select username from public.leaderboard('net-electric')`,
    );
    expect(after.map((r) => r.username)).toEqual(["alice"]);
  });

  it("orders boards in the same direction as the sim-runner category definitions", () => {
    // The SQL treats only lightest-net-positive as lower-is-better.
    const lowerIsBetter = LEADERBOARD_CATEGORIES.filter((c) => !c.higherIsBetter).map((c) => c.id);
    expect(lowerIsBetter).toEqual(["lightest-net-positive"]);
  });
});

describe("discover and reports", () => {
  it("lists only public projects", async () => {
    const rows = await t.as<{ id: string; visibility?: string; owner_username: string }>(
      null,
      `select * from public.discover_projects('newest', 100, 0, null)`,
    );
    const ids = new Set(rows.map((r) => r.id));
    const all = await t.as<{ id: string; visibility: string }>(
      "service",
      `select id, visibility from public.projects`,
    );
    for (const project of all) expect(ids.has(project.id)).toBe(project.visibility === "public");
  });

  it("lets users file reports and read only their own", async () => {
    const [target] = await t.as<{ id: string }>(
      null,
      `select id from public.projects where visibility = 'public' limit 1`,
    );
    await t.as(BOB, `insert into public.reports (project_id, reason) values ($1, 'spam')`, [
      target!.id,
    ]);
    expect(await t.as(BOB, `select id from public.reports`)).toHaveLength(1);
    expect(await t.as(ALICE, `select id from public.reports`)).toEqual([]);
    await expectDenied(
      t.as(null, `insert into public.reports (project_id, reason) values ($1, 'x')`, [target!.id]),
    );
  });
});

describe("storage", () => {
  it("lets users write images only into their own folder", async () => {
    await t.as(ALICE, `insert into storage.objects (bucket_id, name) values ('thumbnails', $1)`, [
      `${ALICE}/p1/abc.webp`,
    ]);
    await expectDenied(
      t.as(ALICE, `insert into storage.objects (bucket_id, name) values ('thumbnails', $1)`, [
        `${BOB}/p1/abc.webp`,
      ]),
    );
    await expectDenied(
      t.as(null, `insert into storage.objects (bucket_id, name) values ('avatars', 'x/y.png')`),
    );
    expect(
      await t.as(BOB, `delete from storage.objects where name like $1 returning id`, [
        `${ALICE}/%`,
      ]),
    ).toEqual([]);
    const [bucket] = await t.as<{ public: boolean; file_size_limit: number }>(
      "service",
      `select public, file_size_limit from storage.buckets where id = 'thumbnails'`,
    );
    expect(bucket).toEqual({ public: true, file_size_limit: 1048576 });
  });
});

describe("grants", () => {
  it("exposes no internal trigger function to clients", async () => {
    await expectDenied(t.as(ALICE, `select public.handle_new_user()`), /permission denied|trigger/);
  });

  it("has RLS enabled on every public table", async () => {
    const rows = await t.as<{ relname: string; relrowsecurity: boolean }>(
      "service",
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it("lets anonymous clients execute only the public read functions and their own role lookup", async () => {
    await t.db.exec("reset role");
    const { rows } = await t.db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    // project_role() only reports the caller's own role (always null for anonymous callers).
    expect(rows.map((r) => r.proname)).toEqual([
      "discover_projects",
      "leaderboard",
      "project_role",
    ]);
  });
});
