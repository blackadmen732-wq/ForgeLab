-- Durable human work orders. No presence, audio or simulation state is stored here.
-- All writes use narrowly scoped RPCs; RLS guards reads even with a guessed task UUID.
create or replace function public.role_permissions(p_role public.project_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'owner' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design','can_update_work','can_manage_channel','can_invite','can_mute_others','can_remove_member','can_assign_work']
    when 'admin' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design','can_update_work','can_manage_channel','can_invite','can_mute_others','can_remove_member','can_assign_work']
    when 'member' then array['can_view','can_join_voice','can_speak','can_send_messages','can_edit_design','can_update_work']
    when 'viewer' then array['can_view','can_join_voice']
    else array[]::text[] end
$$;

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_by uuid not null references public.profiles(id),
  assigned_to uuid not null references public.profiles(id),
  target_component_id text not null check (target_component_id ~ '^[A-Za-z0-9:_-]{1,80}$'),
  -- The target existed in this saved revision. Deleting it later does not erase history.
  target_version_id uuid references public.project_versions(id) on delete set null,
  task_type text not null check (task_type in ('build','connect','configure','inspect','repair')),
  title text not null check (char_length(title) between 1 and 120 and title = btrim(title) and title !~ '[[:cntrl:]]'),
  description text not null default '' check (char_length(description) <= 2000),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  status text not null default 'offered' check (status in ('offered','accepted','in_progress','blocked','completed','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);
create index work_orders_project_status_idx on public.work_orders(project_id, status, created_at desc);
create index work_orders_assignee_idx on public.work_orders(assigned_to, project_id);
alter table public.work_orders enable row level security;
revoke all on public.work_orders from public, anon, authenticated;
grant select on public.work_orders to authenticated;
create policy "project members read work orders" on public.work_orders
  for select to authenticated using (public.project_role(project_id) is not null);

create function public.create_work_order(
  p_project uuid, p_assignee uuid, p_component text, p_type text,
  p_title text, p_description text default '', p_priority text default 'normal'
) returns public.work_orders language plpgsql security definer set search_path = '' as $$
declare
  version_id uuid;
  result public.work_orders;
begin
  if not ('can_assign_work' = any(public.role_permissions(public.project_role(p_project)))) then
    raise exception 'You cannot assign work in this project.' using errcode = '42501';
  end if;
  -- Serialize assignments per project, both for the active budget and target revision.
  select latest_version_id into version_id from public.projects where id = p_project for update;
  if not exists (select 1 from public.project_members where project_id = p_project
    and user_id = p_assignee and 'can_update_work' = any(public.role_permissions(role))) then
    raise exception 'Assign work to an editor in this project.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.project_versions v,
    lateral jsonb_array_elements(v.design->'components') c
    where v.id = version_id and v.project_id = p_project and c->>'id' = p_component) then
    raise exception 'Save the target component to this cloud project before assigning work.' using errcode = '22023';
  end if;
  if (select count(*) from public.work_orders where project_id = p_project
    and status not in ('completed','cancelled')) >= 200 then
    raise exception 'Complete or cancel existing work before adding more (200 active jobs).';
  end if;
  if (select count(*) from public.work_orders where project_id = p_project
    and created_by = auth.uid() and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are assigning work too quickly. Try again in a minute.';
  end if;
  insert into public.work_orders(project_id, created_by, assigned_to, target_component_id,
    target_version_id, task_type, title, description, priority)
  values (p_project, auth.uid(), p_assignee, p_component, version_id,
    p_type, btrim(p_title), coalesce(p_description, ''), p_priority) returning * into result;
  perform public.audit(p_project, 'work.offered', p_assignee,
    jsonb_build_object('work_order_id', result.id, 'component_id', p_component));
  return result;
end;
$$;

create function public.transition_work_order(p_id uuid, p_expected_status text, p_status text)
returns public.work_orders language plpgsql security definer set search_path = '' as $$
declare
  result public.work_orders;
  perms text[];
  allowed text[];
begin
  select * into result from public.work_orders where id = p_id for update;
  if not found or public.project_role(result.project_id) is null then
    raise exception 'Work order not found.' using errcode = '42501';
  end if;
  perms := public.role_permissions(public.project_role(result.project_id));
  if not (('can_update_work' = any(perms) and result.assigned_to = auth.uid())
    or ('can_assign_work' = any(perms) and p_status = 'cancelled')) then
    raise exception 'You cannot update this work order.' using errcode = '42501';
  end if;
  if result.status <> p_expected_status or p_expected_status is null then
    raise exception 'This work order changed. Refresh and try again.' using errcode = '40001';
  end if;
  allowed := case result.status
    when 'offered' then array['accepted','cancelled']
    when 'accepted' then array['in_progress','blocked','cancelled']
    when 'in_progress' then array['blocked','completed','cancelled']
    when 'blocked' then array['in_progress','cancelled']
    else array[]::text[] end;
  if p_status is null or not (p_status = any(allowed)) then
    raise exception 'That work-order transition is not valid.' using errcode = '22023';
  end if;
  update public.work_orders set status = p_status, updated_at = clock_timestamp(),
    completed_at = case when p_status = 'completed' then clock_timestamp() end
    where id = p_id returning * into result;
  perform public.audit(result.project_id, 'work.' || p_status, result.assigned_to,
    jsonb_build_object('work_order_id', result.id, 'previous_status', p_expected_status));
  return result;
end;
$$;

-- A database-generated invalidation, not a client-authored task. Receivers re-read RLS
-- protected rows. Unlike project presence, browsers cannot publish to this topic.
create function public.work_order_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('project_id', new.project_id),
    'work.changed', 'work:' || new.project_id::text, true);
  return null;
end;
$$;
create trigger work_order_changed after insert or update on public.work_orders
  for each row execute function public.work_order_changed();
create policy "project members receive durable work invalidations" on realtime.messages
  for select to authenticated using (
    public.realtime_topic_id((select realtime.topic()), 'work') is not null and
    public.project_role(public.realtime_topic_id((select realtime.topic()), 'work')) is not null
  );
revoke all on function public.create_work_order(uuid,uuid,text,text,text,text,text) from public, anon;
revoke all on function public.transition_work_order(uuid,text,text) from public, anon;
revoke all on function public.work_order_changed() from public, anon, authenticated;
grant execute on function public.create_work_order(uuid,uuid,text,text,text,text,text) to authenticated;
grant execute on function public.transition_work_order(uuid,text,text) to authenticated;
