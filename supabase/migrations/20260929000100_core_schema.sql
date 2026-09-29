-- ForgeLab V0.1 core schema.
--
-- Relational metadata (owners, visibility, counts, lineage) lives in columns; the variable
-- design document lives in project_versions.design as JSONB, exactly as sim-core writes it
-- (schemaVersion 2). Row-level security and grants are in the next migration: nothing in
-- this file is reachable by the anon or authenticated roles until then.

-- ---------------------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  bio text not null default '' check (char_length(bio) <= 500),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Public creator profile, one per auth user. Created by trigger on sign-up.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Creates the profile for a new auth user with a unique, valid username derived from the
-- requested username, the email local part, or a fallback.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix int := 0;
begin
  base := regexp_replace(
    lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1))),
    '[^a-z0-9_]', '', 'g'
  );
  if char_length(base) < 3 then
    base := 'engineer';
  end if;
  base := left(base, 20);
  candidate := base;
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := base || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), candidate), 60)
  );
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------
-- Projects and versions
-- ---------------------------------------------------------------------------------------

create type public.project_visibility as enum ('private', 'public');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  description text not null default '' check (char_length(description) <= 4000),
  visibility public.project_visibility not null default 'private',
  thumbnail_path text check (thumbnail_path is null or char_length(thumbnail_path) <= 300),
  latest_version_id uuid,
  latest_version_number int not null default 0,
  component_count int not null default 0,
  -- Figures the author's browser reported with its latest save (mass, net power...).
  -- Display only: leaderboard values are recomputed by the server, never read from here.
  stats jsonb not null default '{}'::jsonb
    check (jsonb_typeof(stats) = 'object' and octet_length(stats::text) <= 4000),
  forked_from_project_id uuid references public.projects (id) on delete set null,
  forked_from_version_id uuid,
  like_count int not null default 0 check (like_count >= 0),
  fork_count int not null default 0 check (fork_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create index projects_public_published_idx on public.projects (published_at desc)
  where visibility = 'public';
create index projects_owner_idx on public.projects (owner_id, updated_at desc);
create index projects_forked_from_idx on public.projects (forked_from_project_id);

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_number int not null,
  schema_version int not null check (schema_version >= 1),
  engine_version text not null check (char_length(engine_version) <= 32),
  design jsonb not null
    check (
      jsonb_typeof(design) = 'object'
      and jsonb_typeof(design -> 'components') = 'array'
      and octet_length(design::text) <= 5000000
    ),
  design_hash text not null check (design_hash ~ '^[0-9a-f]{64}$'),
  label text check (label is null or char_length(label) <= 120),
  is_autosave boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (project_id, version_number)
);

create index project_versions_project_idx on public.project_versions (project_id, version_number desc);

alter table public.projects
  add constraint projects_latest_version_fk
  foreign key (latest_version_id) references public.project_versions (id) on delete set null;
alter table public.projects
  add constraint projects_forked_from_version_fk
  foreign key (forked_from_version_id) references public.project_versions (id) on delete set null;

create trigger projects_updated_at before update on public.projects
for each row execute function public.set_updated_at();

-- Stamps the first publication time.
create or replace function public.stamp_published_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visibility = 'public' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$$;

create trigger projects_published_at before insert or update of visibility on public.projects
for each row execute function public.stamp_published_at();

-- Versions are numbered by the database, never by the client. Locking the project row
-- serialises concurrent saves from two tabs.
create or replace function public.assign_version_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_number int;
begin
  select latest_version_number + 1 into next_number
  from public.projects where id = new.project_id for update;
  if next_number is null then
    raise exception 'Project % does not exist.', new.project_id using errcode = 'P0002';
  end if;
  new.version_number := next_number;
  new.created_at := now();
  return new;
end;
$$;

create trigger project_versions_number before insert on public.project_versions
for each row execute function public.assign_version_number();

-- Points the project at its newest version and keeps autosave history bounded: the
-- newest 50 autosaves are kept, plus every named version and any version referenced by a
-- leaderboard entry or a fork.
create or replace function public.after_version_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.projects
  set latest_version_id = new.id,
      latest_version_number = new.version_number,
      component_count = jsonb_array_length(new.design -> 'components')
  where id = new.project_id;

  if new.is_autosave then
    delete from public.project_versions v
    where v.project_id = new.project_id
      and v.is_autosave
      and v.id <> new.id
      and v.id not in (
        select id from public.project_versions
        where project_id = new.project_id and is_autosave
        order by version_number desc
        limit 50
      )
      and not exists (select 1 from public.leaderboard_entries e where e.version_id = v.id)
      and not exists (select 1 from public.project_forks f where f.parent_version_id = v.id)
      and not exists (select 1 from public.projects p where p.forked_from_version_id = v.id);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Runs and leaderboards
-- ---------------------------------------------------------------------------------------

create table public.simulation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.project_versions (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  engine_version text not null check (char_length(engine_version) <= 32),
  scenario_id text not null check (char_length(scenario_id) <= 64),
  duration_sec double precision not null check (duration_sec >= 0),
  results jsonb not null default '{}'::jsonb
    check (jsonb_typeof(results) = 'object' and octet_length(results::text) <= 100000),
  -- True only for runs the server recomputed. Clients cannot set it (see grants).
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create index simulation_runs_user_idx on public.simulation_runs (user_id, created_at desc);

create table public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('net-electric', 'fusion-gain', 'lightest-net-positive')),
  user_id uuid not null references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  version_id uuid not null references public.project_versions (id) on delete cascade,
  run_id uuid references public.simulation_runs (id) on delete set null,
  value double precision not null check (value = value and value > '-Infinity' and value < 'Infinity'),
  engine_version text not null,
  protocol_version int not null,
  scenario_id text not null,
  design_hash text not null check (design_hash ~ '^[0-9a-f]{64}$'),
  confidence text not null check (confidence in ('supported', 'approximate')),
  verified_at timestamptz not null default now(),
  unique (category, user_id, design_hash, engine_version)
);

create index leaderboard_entries_category_idx on public.leaderboard_entries (category, value desc);

create trigger project_versions_after_insert after insert on public.project_versions
for each row execute function public.after_version_insert();

-- ---------------------------------------------------------------------------------------
-- Community: likes, forks, reports
-- ---------------------------------------------------------------------------------------

create table public.project_likes (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index project_likes_project_idx on public.project_likes (project_id);

create or replace function public.maintain_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.projects set like_count = like_count + 1 where id = new.project_id;
  elsif tg_op = 'DELETE' then
    update public.projects set like_count = greatest(like_count - 1, 0) where id = old.project_id;
  end if;
  return null;
end;
$$;

create trigger project_likes_count after insert or delete on public.project_likes
for each row execute function public.maintain_like_count();

create table public.project_forks (
  id uuid primary key default gen_random_uuid(),
  parent_project_id uuid references public.projects (id) on delete set null,
  parent_version_id uuid references public.project_versions (id) on delete set null,
  child_project_id uuid not null unique references public.projects (id) on delete cascade,
  forked_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index project_forks_parent_idx on public.project_forks (parent_project_id);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------
-- Functions exposed to clients
-- ---------------------------------------------------------------------------------------

-- Forks a readable project into a new private project owned by the caller, copying its
-- latest version and recording the lineage. Atomic.
create or replace function public.fork_project(p_source uuid, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  source public.projects%rowtype;
  version public.project_versions%rowtype;
  new_id uuid;
  base_slug text;
  candidate text;
  suffix int := 1;
begin
  if caller is null then
    raise exception 'Sign in to fork a design.' using errcode = '42501';
  end if;

  select * into source from public.projects where id = p_source;
  if not found or (source.visibility <> 'public' and source.owner_id <> caller) then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select * into version from public.project_versions where id = source.latest_version_id;
  if not found then
    raise exception 'That project has no saved version to fork.' using errcode = 'P0002';
  end if;

  base_slug := left(source.slug, 70) || '-fork';
  candidate := base_slug;
  while exists (select 1 from public.projects where owner_id = caller and slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  insert into public.projects (
    owner_id, name, slug, description, visibility, forked_from_project_id, forked_from_version_id
  ) values (
    caller,
    coalesce(nullif(trim(p_name), ''), left(source.name, 112) || ' (fork)'),
    candidate,
    source.description,
    'private',
    source.id,
    version.id
  )
  returning id into new_id;

  insert into public.project_versions (
    project_id, schema_version, engine_version, design, design_hash, label, is_autosave, created_by
  ) values (
    new_id, version.schema_version, version.engine_version, version.design, version.design_hash,
    left('Forked from ' || source.name, 120), false, caller
  );

  insert into public.project_forks (parent_project_id, parent_version_id, child_project_id, forked_by)
  values (source.id, version.id, new_id, caller);

  update public.projects set fork_count = fork_count + 1 where id = source.id;
  return new_id;
end;
$$;

-- Public projects for /discover. Runs with the caller's rights, so RLS still applies.
create or replace function public.discover_projects(
  p_sort text default 'trending',
  p_limit int default 24,
  p_offset int default 0,
  p_search text default null
)
returns table (
  id uuid,
  name text,
  slug text,
  description text,
  thumbnail_path text,
  like_count int,
  fork_count int,
  component_count int,
  stats jsonb,
  published_at timestamptz,
  updated_at timestamptz,
  forked_from_project_id uuid,
  owner_id uuid,
  owner_username text,
  owner_display_name text,
  owner_avatar_path text,
  engine_version text,
  trending_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id, p.name, p.slug, p.description, p.thumbnail_path, p.like_count, p.fork_count,
    p.component_count, p.stats, p.published_at, p.updated_at, p.forked_from_project_id,
    o.id, o.username, o.display_name, o.avatar_path, v.engine_version,
    -- Hacker-News-style gravity: engagement decays with age since publication.
    (p.like_count + 2 * p.fork_count + 1)::double precision
      / power(extract(epoch from (now() - coalesce(p.published_at, p.created_at))) / 3600.0 + 2, 1.5)
  from public.projects p
  join public.profiles o on o.id = p.owner_id
  left join public.project_versions v on v.id = p.latest_version_id
  where p.visibility = 'public'
    and (p_search is null or p.name ilike '%' || p_search || '%' or p.description ilike '%' || p_search || '%')
  order by
    case p_sort
      when 'newest' then extract(epoch from coalesce(p.published_at, p.created_at))
      when 'most-forked' then p.fork_count::double precision
      when 'most-liked' then p.like_count::double precision
      else (p.like_count + 2 * p.fork_count + 1)::double precision
        / power(extract(epoch from (now() - coalesce(p.published_at, p.created_at))) / 3600.0 + 2, 1.5)
    end desc,
    p.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

-- Best verified entry per user in a category, ranked. Lower is better only for the
-- lightest-net-positive board; this must stay in step with LEADERBOARD_CATEGORIES in
-- @forgelab/sim-runner (a test checks it).
create or replace function public.leaderboard(
  p_category text,
  p_limit int default 50,
  p_engine_version text default null
)
returns table (
  rank bigint,
  entry_id uuid,
  value double precision,
  user_id uuid,
  username text,
  display_name text,
  avatar_path text,
  project_id uuid,
  project_name text,
  version_id uuid,
  engine_version text,
  confidence text,
  verified_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with scored as (
    select e.*,
      case when p_category = 'lightest-net-positive' then -e.value else e.value end as score
    from public.leaderboard_entries e
    join public.projects p on p.id = e.project_id
    where e.category = p_category
      and p.visibility = 'public'
      and (p_engine_version is null or e.engine_version = p_engine_version)
  ),
  best as (
    select distinct on (s.user_id) s.*
    from scored s
    order by s.user_id, s.score desc, s.verified_at asc
  )
  select
    rank() over (order by b.score desc, b.verified_at asc),
    b.id, b.value, b.user_id, u.username, u.display_name, u.avatar_path,
    b.project_id, p.name, b.version_id, b.engine_version, b.confidence, b.verified_at
  from best b
  join public.profiles u on u.id = b.user_id
  join public.projects p on p.id = b.project_id
  order by b.score desc, b.verified_at asc
  limit least(greatest(p_limit, 1), 200);
$$;
