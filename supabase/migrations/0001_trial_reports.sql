-- Gardian Trial Reports — migration 0001
-- Runs in the SAME Supabase project as the Load Diagram Tool. Every object is
-- prefixed tr_ so nothing collides with the Load Diagram Tool's tables.
-- Paste into the Supabase SQL Editor and run once. Safe to re-run.
-- Per the LDT database note (2026-10-30), every table below has explicit grants.

-- ───────────────────────────── Members and roles ─────────────────────────────
-- Roles:
--   requester      request trials; see own reports and every approved one, read-only
--   engineer       R&D: build, edit and submit any draft; mark trials completed
--   tech_director  Director of Technology: first sign-off
--   ops_director   Director of Operations: final sign-off
--   admin          everything, incl. users and deleting reports
--   spectator      see everything, comment; emailed on approvals and completions
create table if not exists public.tr_members (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null default '',
  role       text not null default 'requester'
             check (role in ('requester','engineer','tech_director','ops_director','admin','spectator')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.tr_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.tr_members where user_id = auth.uid() and active
$$;

create or replace function public.tr_my_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name,''), email) from public.tr_members where user_id = auth.uid()
$$;

-- Someone removed in the Load Diagram Tool (profiles.role = 'removed') loses
-- Trial Reports access too, since it's the same sign-in.
do $do$ begin
  if to_regclass('public.profiles') is not null then
    execute $f$
      create or replace function public.tr_role() returns text
      language sql stable security definer set search_path = public as $b$
        select m.role from public.tr_members m
        where m.user_id = auth.uid() and m.active
          and not exists (select 1 from public.profiles p where p.id = m.user_id and p.role = 'removed')
      $b$ $f$;
  end if;
end $do$;

-- "Joe Meckler" -> "JM"
create or replace function public.tr_initials(p_name text) returns text
language sql immutable as $$
  select coalesce(string_agg(upper(left(w,1)), '' order by ord), '')
  from regexp_split_to_table(trim(coalesce(p_name,'')), '[\s.]+') with ordinality as t(w, ord)
  where w <> ''
$$;

-- ───────────────────────────────── Reports ──────────────────────────────────
-- status flow (mirrors the LDT chain; send-backs go one step back):
--   draft -> tech_review -> ops_review -> approved -> completed
--   any open status -> cancelled
create table if not exists public.tr_reports (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null default '',
  status             text not null default 'draft'
                     check (status in ('draft','tech_review','ops_review','approved','completed','cancelled')),
  last_action        text,               -- e.g. 'sent_back', 'recalled', 'reopened': drives "Sent back" labels
  requester_name     text not null default '',
  requester_initials text not null default '',
  request_date       date not null default (now() at time zone 'America/New_York')::date,
  rd_lead            text not null default '',
  project            text not null default '',
  part_number        text not null default '',
  data               jsonb not null default '{}'::jsonb,  -- background, goals, tests, samples, ships, disposition
  sign_tech          jsonb,              -- {name,user,at,decision,comment} written by tr_transition only
  sign_ops           jsonb,
  created_by         uuid not null default auth.uid() references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  submitted_at       timestamptz,
  approved_at        timestamptz,
  completed_at       timestamptz
);
create index if not exists tr_reports_status_idx on public.tr_reports(status);
create index if not exists tr_reports_created_by_idx on public.tr_reports(created_by);

-- ───────────────────────────────── Trials ───────────────────────────────────
-- Trial number: LINE-INITIALS-MMDDYY-NN
--   LINE = TG1/TG2/TG3/TG5 (Ty-Gard coating lines), L7 (PSA line), SG (Shock-Gard Line)
--   NN   = order of the trial among ALL trials requested on that date, across every
--          report. Never reused: removing a trial leaves a gap.
create table if not exists public.tr_day_counters (
  day      date primary key,
  last_seq int  not null default 0
);

create table if not exists public.tr_trials (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references public.tr_reports(id) on delete cascade,
  position     int  not null default 0,
  line         text check (line in ('tp','psa','sg')),
  line_no      text check (line_no in ('1','2','3','5')),
  lamp_n       int  not null default 4 check (lamp_n between 1 and 20),
  planned_date date,
  shift        text not null default '',
  duration     text not null default '',
  crew         text not null default '',
  conditions   jsonb not null default '[{"name":""}]'::jsonb,  -- one object per condition (A, B, C…)
  seq          int,
  seq_day      date,
  trial_no     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (seq_day, seq)
);
create index if not exists tr_trials_report_idx on public.tr_trials(report_id, position);
create unique index if not exists tr_trials_no_idx on public.tr_trials(trial_no);

create or replace function public.tr_next_seq(p_day date) returns int
language sql volatile security definer set search_path = public as $$
  insert into public.tr_day_counters as c (day, last_seq) values (p_day, 1)
  on conflict (day) do update set last_seq = c.last_seq + 1
  returning last_seq
$$;

create or replace function public.tr_line_code(p_line text, p_line_no text) returns text
language sql immutable as $$
  select case p_line when 'tp' then 'TG' || coalesce(p_line_no,'?')
                     when 'psa' then 'L7' when 'sg' then 'SG' else '??' end
$$;

create or replace function public.tr_trials_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select request_date, requester_initials into r from public.tr_reports where id = new.report_id;
  if new.seq is null or new.seq_day is distinct from r.request_date then
    new.seq := public.tr_next_seq(r.request_date);
    new.seq_day := r.request_date;
  end if;
  new.trial_no := public.tr_line_code(new.line, new.line_no) || '-' ||
                  coalesce(nullif(r.requester_initials,''),'??') || '-' ||
                  to_char(r.request_date,'MMDDYY') || '-' || lpad(new.seq::text, 2, '0');
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tr_trials_number on public.tr_trials;
create trigger tr_trials_number before insert or update on public.tr_trials
  for each row execute function public.tr_trials_number();

-- ─────────────────────────────── Activity log ───────────────────────────────
create table if not exists public.tr_activity (
  id          bigserial primary key,
  report_id   uuid not null references public.tr_reports(id) on delete cascade,
  at          timestamptz not null default now(),
  actor       uuid default auth.uid(),
  actor_name  text not null default '',
  kind        text not null,   -- created, submitted, recalled, approved_tech, approved_ops, sent_back, reopened, completed, cancelled, comment
  body        text not null default '',
  from_status text,
  to_status   text
);
create index if not exists tr_activity_report_idx on public.tr_activity(report_id, at);

-- ──────────────────────────────── Guards ────────────────────────────────────
-- Status, sign-offs and timestamps change only through tr_transition().
-- Content (report fields and trials) can change only while the report is a draft.
create or replace function public.tr_reports_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requester_initials := public.tr_initials(new.requester_name);
  new.updated_at := now();
  if tg_op = 'UPDATE' and coalesce(current_setting('tr.rpc', true), '') <> 'on' then
    if old.status <> 'draft' then
      raise exception 'This report is %, so it can''t be edited. Ask for it to be reopened or sent back.', old.status;
    end if;
    if new.status is distinct from old.status or new.sign_tech is distinct from old.sign_tech
       or new.sign_ops is distinct from old.sign_ops or new.created_by is distinct from old.created_by
       or new.submitted_at is distinct from old.submitted_at or new.approved_at is distinct from old.approved_at
       or new.completed_at is distinct from old.completed_at or new.last_action is distinct from old.last_action then
      raise exception 'Status and sign-offs change only through Submit, Approve, Send back and the other actions.';
    end if;
  end if;
  if tg_op = 'INSERT' and coalesce(current_setting('tr.rpc', true), '') <> 'on' then
    new.status := 'draft'; new.sign_tech := null; new.sign_ops := null; new.last_action := null;
    new.submitted_at := null; new.approved_at := null; new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tr_reports_guard on public.tr_reports;
create trigger tr_reports_guard before insert or update on public.tr_reports
  for each row execute function public.tr_reports_guard();

-- Renumber a report's trials (in tab order) when its requester or request date changes.
create or replace function public.tr_reports_renumber() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.request_date is distinct from old.request_date or new.requester_initials is distinct from old.requester_initials then
    for t in select id from public.tr_trials where report_id = new.id order by position, created_at loop
      update public.tr_trials set updated_at = now() where id = t.id;
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists tr_reports_renumber on public.tr_reports;
create trigger tr_reports_renumber after update on public.tr_reports
  for each row execute function public.tr_reports_renumber();

create or replace function public.tr_reports_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tr_activity(report_id, actor, actor_name, kind, to_status)
  values (new.id, new.created_by, coalesce(public.tr_my_name(), ''), 'created', new.status);
  return null;
end $$;
drop trigger if exists tr_reports_created on public.tr_reports;
create trigger tr_reports_created after insert on public.tr_reports
  for each row execute function public.tr_reports_created();

create or replace function public.tr_trials_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; rid uuid;
begin
  rid := coalesce(new.report_id, old.report_id);
  if tg_op = 'UPDATE' and new.report_id <> old.report_id then raise exception 'A trial can''t move to another report.'; end if;
  select status into st from public.tr_reports where id = rid;
  if st is distinct from 'draft' and coalesce(current_setting('tr.rpc', true), '') <> 'on'
     and pg_trigger_depth() = 1 then
    raise exception 'Trials can be changed only while the report is a draft.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists tr_trials_guard on public.tr_trials;
create trigger tr_trials_guard before insert or update or delete on public.tr_trials
  for each row execute function public.tr_trials_guard();

-- ─────────────────────────────── Visibility ─────────────────────────────────
create or replace function public.tr_can_see(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tr_reports r
    where r.id = p_report and (
      public.tr_role() in ('engineer','tech_director','ops_director','admin','spectator')
      or r.created_by = auth.uid()
      or (public.tr_role() = 'requester' and r.status in ('approved','completed'))))
$$;

create or replace function public.tr_can_edit(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tr_reports r
    where r.id = p_report and r.status = 'draft' and public.tr_role() is not null
      and (r.created_by = auth.uid() or public.tr_role() in ('engineer','admin')))
$$;

alter table public.tr_members     enable row level security;
alter table public.tr_reports     enable row level security;
alter table public.tr_trials      enable row level security;
alter table public.tr_activity    enable row level security;
alter table public.tr_day_counters enable row level security;

drop policy if exists tr_members_read on public.tr_members;
create policy tr_members_read on public.tr_members for select to authenticated
  using (public.tr_role() is not null);

drop policy if exists tr_reports_read on public.tr_reports;
create policy tr_reports_read on public.tr_reports for select to authenticated
  using (public.tr_can_see(id));
drop policy if exists tr_reports_insert on public.tr_reports;
create policy tr_reports_insert on public.tr_reports for insert to authenticated
  with check (created_by = auth.uid()
              and public.tr_role() in ('requester','engineer','tech_director','ops_director','admin'));
drop policy if exists tr_reports_update on public.tr_reports;
create policy tr_reports_update on public.tr_reports for update to authenticated
  using (public.tr_can_edit(id)) with check (true);
drop policy if exists tr_reports_delete on public.tr_reports;
create policy tr_reports_delete on public.tr_reports for delete to authenticated
  using (public.tr_role() = 'admin'
         or (created_by = auth.uid() and status = 'draft' and submitted_at is null));

drop policy if exists tr_trials_read on public.tr_trials;
create policy tr_trials_read on public.tr_trials for select to authenticated
  using (public.tr_can_see(report_id));
drop policy if exists tr_trials_write on public.tr_trials;
create policy tr_trials_write on public.tr_trials for all to authenticated
  using (public.tr_can_edit(report_id)) with check (public.tr_can_edit(report_id));

drop policy if exists tr_activity_read on public.tr_activity;
create policy tr_activity_read on public.tr_activity for select to authenticated
  using (public.tr_can_see(report_id));
-- no insert policy: activity is written by triggers and the functions below.

-- ─────────────────────────────── Actions (RPC) ──────────────────────────────
create or replace function public.tr_transition(p_report uuid, p_action text, p_comment text default '')
returns public.tr_reports
language plpgsql security definer set search_path = public as $$
declare
  r public.tr_reports; me text := public.tr_role(); nm text := coalesce(public.tr_my_name(), '');
  c text := trim(coalesce(p_comment, '')); nxt text; sig jsonb; prev text;
begin
  if me is null then raise exception 'Your account isn''t set up for Trial Reports.'; end if;
  select * into r from public.tr_reports where id = p_report for update;
  if not found or not public.tr_can_see(p_report) then raise exception 'Report not found.'; end if;
  prev := r.status;

  sig := jsonb_build_object('name', nm, 'user', auth.uid(), 'at', now(),
           'decision', case when c = '' then 'Approved' else 'Approved with comments' end, 'comment', c);

  if p_action = 'submit' then
    if r.status <> 'draft' then raise exception 'Only drafts can be submitted.'; end if;
    if not (r.created_by = auth.uid() or me in ('engineer','admin')) then raise exception 'Only the report''s author or R&D can submit it.'; end if;
    if trim(r.title) = '' or trim(r.requester_name) = '' then raise exception 'Add a report title and the requester before submitting.'; end if;
    if not exists (select 1 from public.tr_trials where report_id = p_report and line is not null) then
      raise exception 'Add at least one trial with a line selected before submitting.'; end if;
    if exists (select 1 from public.tr_trials where report_id = p_report and (line is null or (line = 'tp' and line_no is null))) then
      raise exception 'Every trial needs a line (and a line number for Ty-Gard lines) before submitting.'; end if;
    nxt := 'tech_review';
  elsif p_action = 'recall' then
    if r.status = 'tech_review' and (r.created_by = auth.uid() or me in ('engineer','admin')) then nxt := 'draft';
    elsif r.status = 'ops_review' and me in ('tech_director','admin') then nxt := 'tech_review';
    else raise exception 'This report can''t be recalled by you right now.'; end if;
  elsif p_action = 'approve' then
    if r.status = 'tech_review' and me in ('tech_director','admin') then nxt := 'ops_review';
    elsif r.status = 'ops_review' and me in ('ops_director','admin') then nxt := 'approved';
    else raise exception 'It isn''t your turn to approve this report.'; end if;
  elsif p_action = 'send_back' then
    if c = '' then raise exception 'Add a comment saying what needs to change.'; end if;
    if r.status = 'tech_review' and me in ('tech_director','admin') then nxt := 'draft';
    elsif r.status = 'ops_review' and me in ('ops_director','admin') then nxt := 'tech_review';
    else raise exception 'It isn''t your turn to send this report back.'; end if;
  elsif p_action = 'reopen' then
    if c = '' then raise exception 'Add a comment saying why it''s being reopened.'; end if;
    if r.status = 'approved' and me in ('tech_director','admin') then nxt := 'draft';
    else raise exception 'Only the Director of Technology can reopen an approved report.'; end if;
  elsif p_action = 'complete' then
    if r.status = 'approved' and (r.created_by = auth.uid() or me in ('engineer','admin')) then nxt := 'completed';
    else raise exception 'Only R&D or the report''s author can mark an approved report completed.'; end if;
  elsif p_action = 'cancel' then
    if r.status in ('draft','tech_review','ops_review') and (r.created_by = auth.uid() or me = 'admin') then nxt := 'cancelled';
    else raise exception 'This report can''t be cancelled by you right now.'; end if;
  else
    raise exception 'Unknown action %', p_action;
  end if;

  perform set_config('tr.rpc', 'on', true);
  update public.tr_reports set
    status       = nxt,
    last_action  = p_action,
    submitted_at = case when p_action = 'submit' then now() else submitted_at end,
    sign_tech    = case when p_action = 'approve' and r.status = 'tech_review' then sig
                        when nxt in ('draft','tech_review') then null else sign_tech end,
    sign_ops     = case when p_action = 'approve' and r.status = 'ops_review' then sig
                        when nxt in ('draft','tech_review','ops_review') then null else sign_ops end,
    approved_at  = case when nxt = 'approved' then now() when nxt in ('draft','tech_review','ops_review') then null else approved_at end,
    completed_at = case when nxt = 'completed' then now() else completed_at end
  where id = p_report returning * into r;
  perform set_config('tr.rpc', 'off', true);

  insert into public.tr_activity(report_id, actor_name, kind, body, from_status, to_status)
  values (p_report, nm,
          case when p_action = 'approve' then case when nxt = 'approved' then 'approved_ops' else 'approved_tech' end else p_action end,
          c, prev, nxt);
  return r;
end $$;

create or replace function public.tr_comment(p_report uuid, p_body text) returns public.tr_activity
language plpgsql security definer set search_path = public as $$
declare a public.tr_activity; r public.tr_reports; me text := public.tr_role();
begin
  if me is null then raise exception 'Your account isn''t set up for Trial Reports.'; end if;
  select * into r from public.tr_reports where id = p_report;
  if not found or not public.tr_can_see(p_report) then raise exception 'Report not found.'; end if;
  if me = 'requester' and r.created_by <> auth.uid() then raise exception 'You can view this report but not comment on it.'; end if;
  if trim(coalesce(p_body,'')) = '' then raise exception 'The comment is empty.'; end if;
  insert into public.tr_activity(report_id, actor_name, kind, body, to_status)
  values (p_report, coalesce(public.tr_my_name(), ''), 'comment', trim(p_body), r.status)
  returning * into a;
  return a;
end $$;

-- Admins change a member's role or block them (history is kept, like the LDT).
create or replace function public.tr_set_member(p_user uuid, p_role text, p_active boolean, p_name text default null)
returns public.tr_members
language plpgsql security definer set search_path = public as $$
declare m public.tr_members;
begin
  if public.tr_role() is distinct from 'admin' then raise exception 'Only admins can manage users.'; end if;
  if p_user = auth.uid() and (p_role <> 'admin' or not p_active) then raise exception 'You can''t remove your own admin access.'; end if;
  update public.tr_members set role = p_role, active = p_active, full_name = coalesce(p_name, full_name)
   where user_id = p_user returning * into m;
  return m;
end $$;

-- List view for the Reports page.
create or replace view public.tr_report_list with (security_invoker = true) as
  select r.id, r.title, r.status, r.last_action, r.requester_name, r.request_date, r.project,
         r.created_by, r.created_at, r.updated_at, r.submitted_at, r.approved_at, r.completed_at,
         coalesce((select jsonb_agg(jsonb_build_object('trial_no', t.trial_no, 'line', t.line, 'line_no', t.line_no,
                     'planned_date', t.planned_date, 'conditions', jsonb_array_length(t.conditions)) order by t.position, t.created_at)
                   from public.tr_trials t where t.report_id = r.id), '[]'::jsonb) as trials
  from public.tr_reports r;

-- ─────────────────────────────────── Grants ─────────────────────────────────
grant usage on schema public to authenticated;
grant select on public.tr_members to authenticated;
grant select, insert, update, delete on public.tr_reports to authenticated;
grant select, insert, update, delete on public.tr_trials to authenticated;
grant select on public.tr_activity to authenticated;
grant select on public.tr_report_list to authenticated;
grant all on public.tr_members, public.tr_reports, public.tr_trials, public.tr_activity, public.tr_day_counters to service_role;
grant usage, select on sequence public.tr_activity_id_seq to service_role;
revoke all on public.tr_day_counters from anon, authenticated;
revoke all on public.tr_members, public.tr_reports, public.tr_trials, public.tr_activity from anon;
grant execute on function public.tr_role(), public.tr_my_name(), public.tr_initials(text), public.tr_line_code(text,text),
  public.tr_can_see(uuid), public.tr_can_edit(uuid), public.tr_transition(uuid,text,text),
  public.tr_comment(uuid,text), public.tr_set_member(uuid,text,boolean,text) to authenticated;
revoke execute on function public.tr_next_seq(date) from public, anon, authenticated;
