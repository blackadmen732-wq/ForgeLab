-- ForgeLab V0.1 row-level security and least-privilege grants.
--
-- Principles:
--  * RLS is enabled on every table in the public schema.
--  * Privileges are granted per column: clients can never write owner ids, counters,
--    lineage, version numbers or the `verified` flag.
--  * Nothing a browser can call writes a leaderboard entry. Verified entries are written
--    only by the server (service role) after it recomputes the result.
--  * Private projects and their versions are visible to their owner only.

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_versions enable row level security;
alter table public.simulation_runs enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.project_likes enable row level security;
alter table public.project_forks enable row level security;
alter table public.reports enable row level security;

-- Start from nothing, then grant precisely.
revoke all on table
  public.profiles,
  public.projects,
  public.project_versions,
  public.simulation_runs,
  public.leaderboard_entries,
  public.project_likes,
  public.project_forks,
  public.reports
from anon, authenticated;

revoke all on function public.fork_project(uuid, text) from public, anon;
revoke all on function public.discover_projects(text, int, int, text) from public;
revoke all on function public.leaderboard(text, int, text) from public;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.assign_version_number() from public, anon, authenticated;
revoke all on function public.after_version_insert() from public, anon, authenticated;
revoke all on function public.maintain_like_count() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------
-- profiles: public read; users edit their own profile's editable fields.
-- ---------------------------------------------------------------------------------------

grant select on public.profiles to anon, authenticated;
grant update (username, display_name, bio, avatar_path) on public.profiles to authenticated;

create policy "profiles are public" on public.profiles
  for select to anon, authenticated using (true);

create policy "users update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- projects: public ones readable by anyone; private ones by their owner only.
-- ---------------------------------------------------------------------------------------

grant select on public.projects to anon, authenticated;
grant insert (name, slug, description, visibility, thumbnail_path, stats) on public.projects to authenticated;
grant update (name, slug, description, visibility, thumbnail_path, stats) on public.projects to authenticated;
grant delete on public.projects to authenticated;

create policy "public projects are readable by anyone" on public.projects
  for select to anon, authenticated
  using (visibility = 'public' or owner_id = (select auth.uid()));

create policy "users create their own projects" on public.projects
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

create policy "owners update their projects" on public.projects
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners delete their projects" on public.projects
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- project_versions: append-only. Owners see all; the public sees only the latest and
-- named versions of public projects (never a public project's private autosave history).
-- ---------------------------------------------------------------------------------------

grant select on public.project_versions to anon, authenticated;
grant insert (project_id, schema_version, engine_version, design, design_hash, label, is_autosave)
  on public.project_versions to authenticated;

create policy "versions follow their project's visibility" on public.project_versions
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id
        and (
          p.owner_id = (select auth.uid())
          or (
            p.visibility = 'public'
            and (p.latest_version_id = project_versions.id or not project_versions.is_autosave)
          )
        )
    )
  );

create policy "owners add versions to their projects" on public.project_versions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id and p.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------------------
-- simulation_runs: users record their own unverified runs and read their own runs.
-- ---------------------------------------------------------------------------------------

grant select on public.simulation_runs to authenticated;
grant insert (project_id, version_id, engine_version, scenario_id, duration_sec, results)
  on public.simulation_runs to authenticated;

create policy "users read their own runs" on public.simulation_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users record unverified runs of versions they can read" on public.simulation_runs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and verified = false
    and exists (
      select 1 from public.project_versions v
      join public.projects p on p.id = v.project_id
      where v.id = simulation_runs.version_id
        and v.project_id = simulation_runs.project_id
        and (p.owner_id = (select auth.uid()) or p.visibility = 'public')
    )
  );

-- ---------------------------------------------------------------------------------------
-- leaderboard_entries: readable when the project is public (or yours). No client writes.
-- ---------------------------------------------------------------------------------------

grant select on public.leaderboard_entries to anon, authenticated;

create policy "entries of public projects are readable" on public.leaderboard_entries
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = leaderboard_entries.project_id
        and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------------------
-- project_likes: users like public projects as themselves and see their own likes.
-- ---------------------------------------------------------------------------------------

grant select on public.project_likes to authenticated;
grant insert (project_id) on public.project_likes to authenticated;
grant delete on public.project_likes to authenticated;

create policy "users see their own likes" on public.project_likes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users like public projects" on public.project_likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_likes.project_id and p.visibility = 'public'
    )
  );

create policy "users remove their own likes" on public.project_likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- project_forks: lineage is readable where the child project is readable. Written only
-- by fork_project().
-- ---------------------------------------------------------------------------------------

grant select on public.project_forks to anon, authenticated;

create policy "lineage follows the child project's visibility" on public.project_forks
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_forks.child_project_id
        and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------------------
-- reports: users file reports as themselves and see only their own.
-- ---------------------------------------------------------------------------------------

grant select on public.reports to authenticated;
grant insert (project_id, reason) on public.reports to authenticated;

create policy "users read their own reports" on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy "users report projects they can see" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = reports.project_id
        and (p.visibility = 'public' or p.owner_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------------------

grant execute on function public.fork_project(uuid, text) to authenticated;
grant execute on function public.discover_projects(text, int, int, text) to anon, authenticated;
grant execute on function public.leaderboard(text, int, text) to anon, authenticated;
