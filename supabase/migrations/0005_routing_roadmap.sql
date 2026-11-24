-- Gardian Trial Reports — migration 0005: the 8-step route from the
-- "R&D Trial Report Routing Roadmap" (Nov 24, 2026).
--
--   1 draft        Trial Requester (R&D)   writes the request            -> Engineering
--   2 settings     Engineering             enters line settings          -> Director of Operations
--   3 ops_review   Director of Operations  reviews, signs off            -> Director of Technology
--   4 tech_review  Director of Technology  final approval                -> Plant Manager
--   5 scheduling   Plant Manager           schedules each trial          -> Engineering
--   6 execution    Engineering             runs trials, pulls samples    -> R&D
--   7 testing      R&D                     tests, ships samples          -> closes and sends the package
--   8 closed       (after-trial package sent to Technology, the engineer who
--                  ran the trial, the Plant Manager and Operations)
--
-- At any step the owner can send the report back to the previous owner or
-- straight to the requester, with a comment. Every hand-off is recorded with
-- the person's name and time (acks), not only the two directors' sign-offs.
-- Run after 0001–0004. Safe to re-run.

-- ── Roles: add Plant Manager ───────────────────────────────────────────────
alter table public.tr_members drop constraint if exists tr_members_role_check;
alter table public.tr_members add constraint tr_members_role_check
  check (role in ('requester','engineer','tech_director','ops_director','plant_manager','admin','spectator'));

-- ── Statuses: the 8 steps (old test data is mapped to the nearest step) ─────
alter table public.tr_reports drop constraint if exists tr_reports_status_check;
do $$ begin
  perform set_config('tr.rpc', 'on', true);
  update public.tr_reports set status = case status
    when 'tech_review' then 'ops_review' when 'ops_review' then 'tech_review'
    when 'approved' then 'scheduling' when 'completed' then 'closed' else status end
  where status in ('tech_review','ops_review','approved','completed');
  perform set_config('tr.rpc', 'off', true);
end $$;
alter table public.tr_reports add constraint tr_reports_status_check
  check (status in ('draft','settings','ops_review','tech_review','scheduling','execution','testing','closed','cancelled'));

alter table public.tr_reports add column if not exists acks jsonb not null default '{}'::jsonb;  -- {step: {name,user,at,comment}}
alter table public.tr_reports add column if not exists closed_at timestamptz;
alter table public.tr_trials  add column if not exists run_notes text not null default '';     -- what ran, problems on the line

-- ── Step helpers ─────────────────────────────────────────────────────────────
create or replace function public.tr_next_status(s text) returns text language sql immutable as $$
  select case s when 'draft' then 'settings' when 'settings' then 'ops_review' when 'ops_review' then 'tech_review'
    when 'tech_review' then 'scheduling' when 'scheduling' then 'execution' when 'execution' then 'testing'
    when 'testing' then 'closed' end $$;
create or replace function public.tr_prev_status(s text) returns text language sql immutable as $$
  select case s when 'settings' then 'draft' when 'ops_review' then 'settings' when 'tech_review' then 'ops_review'
    when 'scheduling' then 'tech_review' when 'execution' then 'scheduling' when 'testing' then 'execution' end $$;
create or replace function public.tr_step_no(s text) returns int language sql immutable as $$
  select array_position(array['draft','settings','ops_review','tech_review','scheduling','execution','testing','closed'], s) $$;

-- Is the signed-in person an owner of this report's current step?
create or replace function public.tr_is_owner(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tr_reports r where r.id = p_report and (
    public.tr_role() = 'admin'
    or (r.status = 'draft'       and (r.created_by = auth.uid() or public.tr_role() = 'requester'))
    or (r.status = 'settings'    and public.tr_role() = 'engineer')
    or (r.status = 'ops_review'  and public.tr_role() = 'ops_director')
    or (r.status = 'tech_review' and public.tr_role() = 'tech_director')
    or (r.status = 'scheduling'  and public.tr_role() = 'plant_manager')
    or (r.status = 'execution'   and public.tr_role() = 'engineer')
    or (r.status = 'testing'     and (r.created_by = auth.uid() or public.tr_role() = 'requester'))))
$$;

-- ── Visibility: everyone with a Trial Reports role sees every report ────────
create or replace function public.tr_can_see(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.tr_role() is not null and exists (select 1 from public.tr_reports where id = p_report)
$$;
drop policy if exists tr_reports_read on public.tr_reports;
create policy tr_reports_read on public.tr_reports for select to authenticated using (public.tr_role() is not null);

-- Editing: the current step's owner, at steps where the form is filled in
-- (the two director reviews and closed/cancelled reports are read-only).
-- The app limits each step to its own sections, per the roadmap.
create or replace function public.tr_can_edit(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tr_reports r where r.id = p_report
    and r.status in ('draft','settings','scheduling','execution','testing'))
    and public.tr_is_owner(p_report)
$$;

drop policy if exists tr_reports_delete on public.tr_reports;
create policy tr_reports_delete on public.tr_reports for delete to authenticated
  using (public.tr_role() = 'admin' or (created_by = auth.uid() and status = 'draft' and submitted_at is null));

-- ── Guards ───────────────────────────────────────────────────────────────────
create or replace function public.tr_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requester_initials := public.tr_initials(new.requester_name);
  new.updated_at := now();
  if tg_op = 'UPDATE' and coalesce(current_setting('tr.rpc', true), '') <> 'on' then
    if old.status not in ('draft','settings','scheduling','execution','testing') then
      raise exception 'This report is in %, so it can''t be edited.', old.status;
    end if;
    if old.status <> 'draft' and (new.requester_name is distinct from old.requester_name or new.request_date is distinct from old.request_date) then
      raise exception 'The requester and request date set the trial numbers, so they can only change while the report is a draft.';
    end if;
    if new.status is distinct from old.status or new.sign_tech is distinct from old.sign_tech
       or new.sign_ops is distinct from old.sign_ops or new.acks is distinct from old.acks
       or new.created_by is distinct from old.created_by or new.submitted_at is distinct from old.submitted_at
       or new.approved_at is distinct from old.approved_at or new.completed_at is distinct from old.completed_at
       or new.closed_at is distinct from old.closed_at or new.last_action is distinct from old.last_action then
      raise exception 'Status and sign-offs change only through the hand-off and send-back actions.';
    end if;
  end if;
  if tg_op = 'INSERT' and coalesce(current_setting('tr.rpc', true), '') <> 'on' then
    new.status := 'draft'; new.sign_tech := null; new.sign_ops := null; new.last_action := null; new.acks := '{}'::jsonb;
    new.submitted_at := null; new.approved_at := null; new.completed_at := null; new.closed_at := null;
  end if;
  return new;
end $$;

-- Trials can be added or removed while drafting or entering settings; their
-- details can be filled in at any step where the form is open.
create or replace function public.tr_trials_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; rid uuid;
begin
  rid := coalesce(new.report_id, old.report_id);
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then raise exception 'A trial can''t move to another report.'; end if;
  select status into st from public.tr_reports where id = rid;
  if coalesce(current_setting('tr.rpc', true), '') <> 'on' and pg_trigger_depth() = 1 then
    if tg_op in ('INSERT','DELETE') and st not in ('draft','settings') then
      raise exception 'Trials can only be added or removed while the report is a draft or in settings entry.';
    end if;
    if st not in ('draft','settings','scheduling','execution','testing') then
      raise exception 'This report is in %, so its trials can''t be changed.', st;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

-- ── The hand-off action ─────────────────────────────────────────────────────
-- p_action: 'advance' (complete my step and hand off; directors' approval),
--           'send_back' (p_target 'previous' or 'requester'; comment required),
--           'cancel'.
drop function if exists public.tr_transition(uuid, text, text);
create or replace function public.tr_transition(p_report uuid, p_action text, p_comment text default '', p_target text default 'previous')
returns public.tr_reports
language plpgsql security definer set search_path = public as $$
declare
  r public.tr_reports; me text := public.tr_role(); nm text := coalesce(public.tr_my_name(), '');
  c text := trim(coalesce(p_comment, '')); nxt text; prev text; ack jsonb; k text; bad int;
begin
  if me is null then raise exception 'Your account isn''t set up for Trial Reports.'; end if;
  select * into r from public.tr_reports where id = p_report for update;
  if not found then raise exception 'Report not found.'; end if;
  prev := r.status;
  ack := jsonb_build_object('name', nm, 'user', auth.uid(), 'at', now(), 'comment', c);

  if p_action = 'advance' then
    if r.status not in ('draft','settings','ops_review','tech_review','scheduling','execution','testing') then
      raise exception 'This report has no next step.'; end if;
    if not public.tr_is_owner(p_report) then raise exception 'This step isn''t yours.'; end if;
    if r.status = 'draft' then
      if trim(r.title) = '' or trim(r.requester_name) = '' then raise exception 'Add a report title and the requester first.'; end if;
      if not exists (select 1 from public.tr_trials where report_id = p_report) then raise exception 'Add at least one trial first.'; end if;
      if exists (select 1 from public.tr_trials where report_id = p_report and (line is null or (line = 'tp' and line_no is null))) then
        raise exception 'Every trial needs a line (and a line number for Ty-Gard lines).'; end if;
    elsif r.status = 'settings' then
      -- Every condition needs at least one line setting (beyond its name, material, quantity and notes).
      select count(*) into bad from public.tr_trials t, jsonb_array_elements(t.conditions) cond
       where t.report_id = p_report and not exists (
         select 1 from jsonb_each_text(cond) kv
          where kv.key not in ('name','mat','run','disp','note','asrun','result') and trim(coalesce(kv.value,'')) <> '');
      if bad > 0 then raise exception 'Every condition needs its line settings before it goes to the Director of Operations (% condition(s) still empty).', bad; end if;
    elsif r.status = 'scheduling' then
      if exists (select 1 from public.tr_trials where report_id = p_report and planned_date is null) then
        raise exception 'Set a planned trial date for every trial first.'; end if;
    end if;
    nxt := public.tr_next_status(r.status);
  elsif p_action = 'send_back' then
    if r.status not in ('settings','ops_review','tech_review','scheduling','execution','testing') then
      raise exception 'This report can''t be sent back from here.'; end if;
    if not public.tr_is_owner(p_report) then raise exception 'This step isn''t yours.'; end if;
    if c = '' then raise exception 'Add a comment saying what needs to change.'; end if;
    nxt := case when p_target = 'requester' then 'draft' else public.tr_prev_status(r.status) end;
  elsif p_action = 'cancel' then
    if r.status in ('closed','cancelled') then raise exception 'This report is already %.', r.status; end if;
    if not (r.created_by = auth.uid() or me = 'admin') then raise exception 'Only the report''s author or an admin can cancel it.'; end if;
    nxt := 'cancelled';
  else
    raise exception 'Unknown action %', p_action;
  end if;

  perform set_config('tr.rpc', 'on', true);
  -- Acks: record this step on advance; on a send-back, clear every step from
  -- the target onward, since those approvals no longer stand.
  if p_action = 'advance' then
    r.acks := r.acks || jsonb_build_object(r.status, ack);
  elsif p_action = 'send_back' then
    for k in select jsonb_object_keys(r.acks) loop
      if public.tr_step_no(k) >= public.tr_step_no(nxt) then r.acks := r.acks - k; end if;
    end loop;
  end if;
  update public.tr_reports set
    status       = nxt,
    last_action  = p_action,
    acks         = r.acks,
    submitted_at = case when prev = 'draft' and p_action = 'advance' then now() else submitted_at end,
    sign_ops     = case when p_action = 'advance' and prev = 'ops_review' then ack || jsonb_build_object('decision', case when c = '' then 'Approved' else 'Approved with comments' end)
                        when r.acks ? 'ops_review' then sign_ops else null end,
    sign_tech    = case when p_action = 'advance' and prev = 'tech_review' then ack || jsonb_build_object('decision', case when c = '' then 'Approved' else 'Approved with comments' end)
                        when r.acks ? 'tech_review' then sign_tech else null end,
    approved_at  = case when p_action = 'advance' and prev = 'tech_review' then now() when r.acks ? 'tech_review' then approved_at else null end,
    completed_at = case when p_action = 'advance' and prev = 'execution' then now() when r.acks ? 'execution' then completed_at else null end,
    closed_at    = case when nxt = 'closed' then now() else null end
  where id = p_report returning * into r;
  perform set_config('tr.rpc', 'off', true);

  insert into public.tr_activity(report_id, actor_name, kind, body, from_status, to_status)
  values (p_report, nm, p_action, c, prev, nxt);
  return r;
end $$;

create or replace function public.tr_comment(p_report uuid, p_body text) returns public.tr_activity
language plpgsql security definer set search_path = public as $$
declare a public.tr_activity; r public.tr_reports;
begin
  if public.tr_role() is null then raise exception 'Your account isn''t set up for Trial Reports.'; end if;
  select * into r from public.tr_reports where id = p_report;
  if not found then raise exception 'Report not found.'; end if;
  if trim(coalesce(p_body,'')) = '' then raise exception 'The comment is empty.'; end if;
  insert into public.tr_activity(report_id, actor_name, kind, body, to_status)
  values (p_report, coalesce(public.tr_my_name(), ''), 'comment', trim(p_body), r.status) returning * into a;
  return a;
end $$;

create or replace function public.tr_add_member(p_email text, p_name text, p_role text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; existed boolean;
begin
  if public.tr_role() is distinct from 'admin' then raise exception 'Only admins can manage users.'; end if;
  if p_role not in ('requester','engineer','tech_director','ops_director','plant_manager','admin','spectator') then raise exception 'Unknown role.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then return jsonb_build_object('found', false); end if;
  select exists (select 1 from public.tr_members where user_id = uid) into existed;
  insert into public.tr_members (user_id, email, full_name, role, active)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_name), ''), ''), p_role, true)
  on conflict (user_id) do update set role = excluded.role, active = true,
    full_name = coalesce(nullif(trim(p_name), ''), public.tr_members.full_name);
  return jsonb_build_object('found', true, 'restored', existed);
end $$;

create or replace view public.tr_report_list with (security_invoker = true) as
  select r.id, r.title, r.status, r.last_action, r.requester_name, r.request_date, r.project,
         r.created_by, r.created_at, r.updated_at, r.submitted_at, r.approved_at, r.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('trial_no', t.trial_no, 'line', t.line, 'line_no', t.line_no,
                     'planned_date', t.planned_date, 'conditions', jsonb_array_length(t.conditions)) order by t.position, t.created_at)
                   from public.tr_trials t where t.report_id = r.id), '[]'::jsonb) as trials,
         r.closed_at
  from public.tr_reports r;

grant select on public.tr_report_list to authenticated;
grant execute on function public.tr_transition(uuid,text,text,text), public.tr_is_owner(uuid),
  public.tr_next_status(text), public.tr_prev_status(text), public.tr_step_no(text), public.tr_comment(uuid,text) to authenticated;
revoke execute on function public.tr_transition(uuid,text,text,text) from anon;
