-- ForgeLab collaboration: project membership and roles, invites, channels (voice + text),
-- messages, audit trail, server-side rate limiting, and Realtime authorization.
--
-- Design: docs/COMMUNICATIONS.md. Everything that decides access goes through three
-- SECURITY DEFINER functions — project_role(), role_permissions(), channel_permissions() —
-- so policies, RPCs, Realtime and the server endpoints share one model. The TypeScript
-- mirror in @forgelab/protocol is tested against role_permissions().
--
-- Nothing here carries audio or high-frequency state. Speaking, mute and presence live in
-- Realtime and the voice SFU and are never written to Postgres.

-- ---------------------------------------------------------------------------------------
-- Roles and membership
-- ---------------------------------------------------------------------------------------

create type public.project_role as enum ('owner', 'admin', 'member', 'viewer');

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.project_role not null default 'member',
  invited_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_members_user_idx on public.project_members (user_id);
create unique index project_members_one_owner on public.project_members (project_id) where role = 'owner';

comment on table public.project_members is 'Who belongs to a project and in what role. Written only through RPCs and triggers.';

-- The caller's role in a project, or null. SECURITY DEFINER so policies on
-- project_members itself can use it without recursing through RLS.
create or replace function public.project_role(p_project uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.project_members m
  where m.project_id = p_project and m.user_id = (select auth.uid())
$$;

-- The permission matrix. Must match ROLE_PERMISSIONS in packages/protocol/src/roles.ts.
create or replace function public.role_permissions(p_role public.project_role)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'owner' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design','can_manage_channel','can_invite','can_mute_others','can_remove_member']
    when 'admin' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design','can_manage_channel','can_invite','can_mute_others','can_remove_member']
    when 'member' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design']
    when 'viewer' then array['can_view','can_join_voice']
    else array[]::text[]
  end
$$;

create or replace function public.role_rank(p_role public.project_role)
returns int
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'member' then 1 else 0 end
$$;

-- ---------------------------------------------------------------------------------------
-- Channels: every channel has both voice and text.
-- ---------------------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null
    check (char_length(btrim(name)) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  position int not null default 0,
  is_private boolean not null default false,
  settings jsonb not null default '{}'::jsonb
    check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 2000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index channels_project_name_idx on public.channels (project_id, lower(name));
create index channels_project_idx on public.channels (project_id, position);

-- Access list for private channels (owners and admins see every channel).
create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members (user_id);

-- What the caller may do in a channel. Empty when the channel does not exist or the
-- caller has no access — the API treats both the same, so ids cannot be probed.
create or replace function public.channel_permissions(p_channel uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.channels%rowtype;
  r public.project_role;
begin
  select * into c from public.channels where id = p_channel;
  if not found then
    return array[]::text[];
  end if;
  select m.role into r from public.project_members m
  where m.project_id = c.project_id and m.user_id = (select auth.uid());
  if r is null then
    return array[]::text[];
  end if;
  if c.is_private and r not in ('owner', 'admin') and not exists (
    select 1 from public.channel_members cm where cm.channel_id = c.id and cm.user_id = (select auth.uid())
  ) then
    return array[]::text[];
  end if;
  return public.role_permissions(r);
end;
$$;

-- For the voice endpoint: the channel's project and the caller's permissions in one call.
create or replace function public.channel_access(p_channel uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  perms text[] := public.channel_permissions(p_channel);
  c public.channels%rowtype;
begin
  if not ('can_view' = any(perms)) then
    return null;
  end if;
  select * into c from public.channels where id = p_channel;
  return jsonb_build_object(
    'channel_id', c.id,
    'project_id', c.project_id,
    'name', c.name,
    'is_private', c.is_private,
    'permissions', to_jsonb(perms)
  );
end;
$$;

-- For the presence-ticket endpoint: the caller's role and display name in a project.
create or replace function public.project_access(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', m.project_id,
    'role', m.role,
    'name', coalesce(nullif(p.display_name, ''), p.username)
  )
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project and m.user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null
    check (char_length(content) between 1 and 2000 and content = btrim(content)
           and content !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'),
  -- References into the workspace ({kind, id, start, end}); rendered as links later.
  refs jsonb not null default '[]'::jsonb
    check (jsonb_typeof(refs) = 'array' and jsonb_array_length(refs) <= 20 and octet_length(refs::text) <= 4000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index messages_channel_idx on public.messages (channel_id, created_at desc);
create index messages_user_idx on public.messages (user_id, created_at desc);

-- Identity, project and time come from the server, never the client; rate limited.
create or replace function public.before_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  recent int;
begin
  if caller is null then
    raise exception 'Sign in to send messages.' using errcode = '42501';
  end if;
  new.user_id := caller;
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  select c.project_id into new.project_id from public.channels c where c.id = new.channel_id;
  if new.project_id is null then
    raise exception 'Channel not found.' using errcode = 'P0002';
  end if;
  select count(*) into recent from public.messages m
  where m.user_id = caller and m.project_id = new.project_id and m.created_at > now() - interval '10 seconds';
  if recent >= 8 then
    raise exception 'rate_limited: you are sending messages too quickly.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger messages_before_insert before insert on public.messages
for each row execute function public.before_message_insert();

-- Delivers new messages to subscribers of the channel's private Realtime topic.
create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', new.id, 'project_id', new.project_id, 'channel_id', new.channel_id,
      'user_id', new.user_id, 'content', new.content, 'refs', new.refs, 'created_at', new.created_at
    ),
    'message',
    'chat:' || new.channel_id::text,
    true
  );
  return null;
end;
$$;

create trigger messages_after_insert after insert on public.messages
for each row execute function public.after_message_insert();

-- ---------------------------------------------------------------------------------------
-- Invites: the code is shown once; only its SHA-256 is stored.
-- ---------------------------------------------------------------------------------------

create table public.project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  role public.project_role not null check (role <> 'owner'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null check (max_uses between 1 and 100),
  uses int not null default 0 check (uses >= 0),
  revoked_at timestamptz
);

create index project_invites_project_idx on public.project_invites (project_id, created_at desc);

-- ---------------------------------------------------------------------------------------
-- Audit trail for administrative actions.
-- ---------------------------------------------------------------------------------------

create table public.audit_events (
  id bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 64),
  target_user_id uuid references public.profiles (id) on delete set null,
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 4000),
  created_at timestamptz not null default now()
);

create index audit_events_project_idx on public.audit_events (project_id, created_at desc);

create or replace function public.audit(p_project uuid, p_action text, p_target uuid, p_details jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_events (project_id, actor_id, action, target_user_id, details)
  values (p_project, (select auth.uid()), p_action, p_target, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function public.audit_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit(new.project_id, 'member.added', new.user_id, jsonb_build_object('role', new.role));
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform public.audit(new.project_id, 'member.role_changed', new.user_id,
      jsonb_build_object('from', old.role, 'to', new.role));
  elsif tg_op = 'DELETE' then
    -- The project row may already be gone (cascade); only audit live projects.
    if exists (select 1 from public.projects where id = old.project_id) then
      perform public.audit(old.project_id, 'member.removed', old.user_id, jsonb_build_object('role', old.role));
    end if;
    delete from public.channel_members cm
    using public.channels c
    where cm.channel_id = c.id and c.project_id = old.project_id and cm.user_id = old.user_id;
  end if;
  return null;
end;
$$;

create trigger project_members_audit after insert or update or delete on public.project_members
for each row execute function public.audit_membership();

create or replace function public.audit_channels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit(new.project_id, 'channel.created', null,
      jsonb_build_object('channel_id', new.id, 'name', new.name, 'private', new.is_private));
  elsif tg_op = 'UPDATE' then
    perform public.audit(new.project_id, 'channel.updated', null,
      jsonb_build_object('channel_id', new.id, 'from', old.name, 'to', new.name));
  elsif tg_op = 'DELETE' and exists (select 1 from public.projects where id = old.project_id) then
    perform public.audit(old.project_id, 'channel.deleted', null,
      jsonb_build_object('channel_id', old.id, 'name', old.name));
  end if;
  return null;
end;
$$;

create trigger channels_audit after insert or update or delete on public.channels
for each row execute function public.audit_channels();

-- ---------------------------------------------------------------------------------------
-- New projects: the owner becomes a member and a General channel exists.
-- ---------------------------------------------------------------------------------------

create or replace function public.after_project_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into public.channels (project_id, name, position, created_by) values (new.id, 'General', 0, new.owner_id);
  return null;
end;
$$;

create trigger projects_after_insert after insert on public.projects
for each row execute function public.after_project_insert();

-- Existing projects.
insert into public.project_members (project_id, user_id, role)
select id, owner_id, 'owner' from public.projects
on conflict do nothing;

insert into public.channels (project_id, name, position, created_by)
select p.id, 'General', 0, p.owner_id from public.projects p
where not exists (select 1 from public.channels c where c.project_id = p.id);

-- ---------------------------------------------------------------------------------------
-- Conflict protection for shared projects: a save names the version it was based on.
-- ---------------------------------------------------------------------------------------

alter table public.project_versions
  add column parent_version_id uuid references public.project_versions (id) on delete set null;

create or replace function public.assign_version_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  latest_number int;
  latest_id uuid;
begin
  select latest_version_number, latest_version_id into latest_number, latest_id
  from public.projects where id = new.project_id for update;
  if latest_number is null then
    raise exception 'Project % does not exist.', new.project_id using errcode = 'P0002';
  end if;
  -- Two members editing the same project must never silently overwrite each other.
  if latest_id is not null and new.parent_version_id is distinct from latest_id then
    raise exception 'stale_version: someone saved a newer version of this project.'
      using errcode = 'P0001', detail = latest_id::text;
  end if;
  new.version_number := latest_number + 1;
  new.created_at := now();
  return new;
end;
$$;

-- fork_project copies the source's latest version into a brand-new project (no parent).
-- Nothing else changes there, so the function is untouched.

-- ---------------------------------------------------------------------------------------
-- RPCs: membership, invites and channels. All authorization happens in here.
-- ---------------------------------------------------------------------------------------

create or replace function public.create_invite(p_project uuid, p_role public.project_role, p_hours int default 168, p_max_uses int default 10)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.project_role := public.project_role(p_project);
  code text;
begin
  if caller_role is null or not ('can_invite' = any(public.role_permissions(caller_role))) then
    raise exception 'You cannot invite people to this project.' using errcode = '42501';
  end if;
  if p_role = 'owner' or public.role_rank(p_role) >= public.role_rank(caller_role) and caller_role <> 'owner' then
    raise exception 'You cannot invite someone with that role.' using errcode = '42501';
  end if;
  if p_hours not between 1 and 720 or p_max_uses not between 1 and 100 then
    raise exception 'Invites last 1 hour to 30 days and allow 1 to 100 uses.' using errcode = '22023';
  end if;
  -- 244 bits of randomness from two v4 UUIDs; only the hash is stored.
  code := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.project_invites (project_id, code_hash, role, created_by, expires_at, max_uses)
  values (p_project, encode(sha256(convert_to(code, 'UTF8')), 'hex'), p_role, auth.uid(),
          now() + make_interval(hours => p_hours), p_max_uses);
  perform public.audit(p_project, 'invite.created', null,
    jsonb_build_object('role', p_role, 'hours', p_hours, 'max_uses', p_max_uses));
  return code;
end;
$$;

create or replace function public.accept_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  inv public.project_invites%rowtype;
begin
  if caller is null then
    raise exception 'Sign in to accept an invite.' using errcode = '42501';
  end if;
  if p_code is null or p_code !~ '^[0-9a-f]{64}$' then
    raise exception 'That invite is not valid.' using errcode = 'P0002';
  end if;
  select * into inv from public.project_invites
  where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
  for update;
  if not found or inv.revoked_at is not null or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'That invite is not valid or has expired.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.project_members where project_id = inv.project_id and user_id = caller) then
    return inv.project_id; -- already a member: never change an existing role through an invite
  end if;
  insert into public.project_members (project_id, user_id, role, invited_by)
  values (inv.project_id, caller, inv.role, inv.created_by);
  update public.project_invites set uses = uses + 1 where id = inv.id;
  return inv.project_id;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.project_invites%rowtype;
  caller_role public.project_role;
begin
  select * into inv from public.project_invites where id = p_invite;
  caller_role := public.project_role(inv.project_id);
  if not found or caller_role is null or not ('can_invite' = any(public.role_permissions(caller_role))) then
    raise exception 'Invite not found.' using errcode = 'P0002';
  end if;
  update public.project_invites set revoked_at = now() where id = p_invite and revoked_at is null;
  perform public.audit(inv.project_id, 'invite.revoked', null, jsonb_build_object('invite_id', p_invite));
end;
$$;

create or replace function public.set_member_role(p_project uuid, p_user uuid, p_role public.project_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.project_role := public.project_role(p_project);
  target_role public.project_role;
begin
  select role into target_role from public.project_members where project_id = p_project and user_id = p_user;
  if caller_role is null or target_role is null then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  -- Mirrors canAssignRole() in @forgelab/protocol.
  if target_role = 'owner' or p_role = 'owner'
     or not (caller_role = 'owner'
             or (caller_role = 'admin' and public.role_rank(target_role) < 2 and public.role_rank(p_role) < 2)) then
    raise exception 'You cannot give that role.' using errcode = '42501';
  end if;
  update public.project_members set role = p_role where project_id = p_project and user_id = p_user;
end;
$$;

-- Removes a member (or lets a member leave). The owner cannot be removed.
create or replace function public.remove_member(p_project uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_role public.project_role := public.project_role(p_project);
  target_role public.project_role;
begin
  select role into target_role from public.project_members where project_id = p_project and user_id = p_user;
  if caller_role is null or target_role is null then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
  if target_role = 'owner' then
    raise exception 'The owner cannot be removed.' using errcode = '42501';
  end if;
  -- Mirrors canRemoveMember() in @forgelab/protocol; anyone may leave.
  if p_user <> caller and not (caller_role = 'owner' or (caller_role = 'admin' and public.role_rank(target_role) < 2)) then
    raise exception 'You cannot remove that member.' using errcode = '42501';
  end if;
  delete from public.project_members where project_id = p_project and user_id = p_user;
end;
$$;

create or replace function public.create_channel(p_project uuid, p_name text, p_private boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role public.project_role := public.project_role(p_project);
  new_id uuid;
  next_position int;
begin
  if caller_role is null or not ('can_manage_channel' = any(public.role_permissions(caller_role))) then
    raise exception 'You cannot manage channels in this project.' using errcode = '42501';
  end if;
  if (select count(*) from public.channels where project_id = p_project) >= 50 then
    raise exception 'A project can have at most 50 channels.' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) + 1 into next_position from public.channels where project_id = p_project;
  insert into public.channels (project_id, name, position, is_private, created_by)
  values (p_project, btrim(p_name), next_position, coalesce(p_private, false), auth.uid())
  returning id into new_id;
  if p_private then
    insert into public.channel_members (channel_id, user_id, added_by) values (new_id, auth.uid(), auth.uid());
  end if;
  return new_id;
end;
$$;

create or replace function public.rename_channel(p_channel uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ('can_manage_channel' = any(public.channel_permissions(p_channel))) then
    raise exception 'Channel not found.' using errcode = 'P0002';
  end if;
  update public.channels set name = btrim(p_name) where id = p_channel;
end;
$$;

create or replace function public.delete_channel(p_channel uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
begin
  if not ('can_manage_channel' = any(public.channel_permissions(p_channel))) then
    raise exception 'Channel not found.' using errcode = 'P0002';
  end if;
  select project_id into pid from public.channels where id = p_channel;
  if (select count(*) from public.channels where project_id = pid) <= 1 then
    raise exception 'A project needs at least one channel.' using errcode = '22023';
  end if;
  delete from public.channels where id = p_channel;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Server-side rate limiting for the comms endpoints (service role only).
-- ---------------------------------------------------------------------------------------

create table public.rate_events (
  user_id uuid not null,
  bucket text not null check (char_length(bucket) <= 40),
  created_at timestamptz not null default now()
);

create index rate_events_lookup_idx on public.rate_events (user_id, bucket, created_at desc);

create or replace function public.consume_rate(p_user uuid, p_bucket text, p_max int, p_window_sec int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  delete from public.rate_events where user_id = p_user and bucket = p_bucket and created_at < now() - interval '1 day';
  select count(*) into recent from public.rate_events
  where user_id = p_user and bucket = p_bucket and created_at > now() - make_interval(secs => p_window_sec);
  if recent >= p_max then
    return false;
  end if;
  insert into public.rate_events (user_id, bucket) values (p_user, p_bucket);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------------------

alter table public.project_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;
alter table public.project_invites enable row level security;
alter table public.audit_events enable row level security;
alter table public.rate_events enable row level security;

revoke all on table
  public.project_members, public.channels, public.channel_members, public.messages,
  public.project_invites, public.audit_events, public.rate_events
from anon, authenticated;

grant select on public.project_members to authenticated;
grant select on public.channels to authenticated;
grant select on public.channel_members to authenticated;
grant select on public.messages to authenticated;
grant insert (channel_id, content, refs) on public.messages to authenticated;
grant select (id, project_id, role, created_by, created_at, expires_at, max_uses, uses, revoked_at)
  on public.project_invites to authenticated;
grant select on public.audit_events to authenticated;

create policy "members see their project's members" on public.project_members
  for select to authenticated using (public.project_role(project_id) is not null);

create policy "members see channels they can view" on public.channels
  for select to authenticated using ('can_view' = any(public.channel_permissions(id)));

create policy "private-channel lists: admins and the member themselves" on public.channel_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.channels c
      where c.id = channel_members.channel_id and public.project_role(c.project_id) in ('owner', 'admin')
    )
  );

create policy "members read channels they can view" on public.messages
  for select to authenticated using ('can_view' = any(public.channel_permissions(channel_id)));

create policy "members post where they may send" on public.messages
  for insert to authenticated
  with check ('can_send_messages' = any(public.channel_permissions(channel_id)));

create policy "inviters see their project's invites" on public.project_invites
  for select to authenticated
  using ('can_invite' = any(public.role_permissions(public.project_role(project_id))));

create policy "owners and admins read the audit trail" on public.audit_events
  for select to authenticated using (public.project_role(project_id) in ('owner', 'admin'));

-- Projects and versions: members now see private projects; editors may save.
drop policy "public projects are readable by anyone" on public.projects;
create policy "public projects are readable by anyone" on public.projects
  for select to anon, authenticated
  using (visibility = 'public' or owner_id = (select auth.uid()) or public.project_role(id) is not null);

drop policy "versions follow their project's visibility" on public.project_versions;
create policy "versions follow their project's visibility" on public.project_versions
  for select to anon, authenticated
  using (
    public.project_role(project_id) is not null
    or exists (
      select 1 from public.projects p
      where p.id = project_versions.project_id
        and p.visibility = 'public'
        and (p.latest_version_id = project_versions.id or not project_versions.is_autosave)
    )
  );

drop policy "owners add versions to their projects" on public.project_versions;
create policy "editors add versions to their projects" on public.project_versions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and 'can_edit_design' = any(public.role_permissions(public.project_role(project_id)))
  );

grant insert (parent_version_id) on public.project_versions to authenticated;

-- Functions: clients may call the access helpers and the RPCs; nothing else.
revoke all on function public.project_role(uuid) from public;
revoke all on function public.role_permissions(public.project_role) from public, anon;
revoke all on function public.role_rank(public.project_role) from public, anon;
revoke all on function public.channel_permissions(uuid) from public, anon;
revoke all on function public.channel_access(uuid) from public, anon;
revoke all on function public.project_access(uuid) from public, anon;
revoke all on function public.create_invite(uuid, public.project_role, int, int) from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.set_member_role(uuid, uuid, public.project_role) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.create_channel(uuid, text, boolean) from public, anon;
revoke all on function public.rename_channel(uuid, text) from public, anon;
revoke all on function public.delete_channel(uuid) from public, anon;
revoke all on function public.audit(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.consume_rate(uuid, text, int, int) from public, anon, authenticated;
revoke all on function public.before_message_insert() from public, anon, authenticated;
revoke all on function public.after_message_insert() from public, anon, authenticated;
revoke all on function public.audit_membership() from public, anon, authenticated;
revoke all on function public.audit_channels() from public, anon, authenticated;
revoke all on function public.after_project_insert() from public, anon, authenticated;

-- Anonymous visitors evaluate the public-projects policy, which asks for their (null) role.
grant execute on function public.project_role(uuid) to anon, authenticated;
grant execute on function public.role_permissions(public.project_role) to authenticated;
grant execute on function public.role_rank(public.project_role) to authenticated;
grant execute on function public.channel_permissions(uuid) to authenticated;
grant execute on function public.channel_access(uuid) to authenticated;
grant execute on function public.project_access(uuid) to authenticated;
grant execute on function public.create_invite(uuid, public.project_role, int, int) to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, public.project_role) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.create_channel(uuid, text, boolean) to authenticated;
grant execute on function public.rename_channel(uuid, text) to authenticated;
grant execute on function public.delete_channel(uuid) to authenticated;
grant execute on function public.consume_rate(uuid, text, int, int) to service_role;

-- ---------------------------------------------------------------------------------------
-- Realtime authorization (private channels).
--   project:<uuid>  presence + signed collaboration events — project members only
--   chat:<uuid>     new-message delivery — channel viewers only; clients cannot publish
-- ---------------------------------------------------------------------------------------

create or replace function public.realtime_topic_id(p_topic text, p_prefix text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ ('^' || p_prefix || ':[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then substr(p_topic, char_length(p_prefix) + 2)::uuid
  end
$$;

revoke all on function public.realtime_topic_id(text, text) from public, anon;
grant execute on function public.realtime_topic_id(text, text) to authenticated;

create policy "forgelab: members receive project presence; viewers receive chat" on realtime.messages
  for select to authenticated
  using (
    (public.realtime_topic_id((select realtime.topic()), 'project') is not null
      and public.project_role(public.realtime_topic_id((select realtime.topic()), 'project')) is not null)
    or
    (public.realtime_topic_id((select realtime.topic()), 'chat') is not null
      and 'can_view' = any(public.channel_permissions(public.realtime_topic_id((select realtime.topic()), 'chat'))))
  );

create policy "forgelab: members publish presence and events on their project" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('presence', 'broadcast')
    and public.realtime_topic_id((select realtime.topic()), 'project') is not null
    and public.project_role(public.realtime_topic_id((select realtime.topic()), 'project')) is not null
  );
