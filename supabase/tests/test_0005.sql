\set ON_ERROR_STOP on
-- Route tests for migration 0005 (8 steps). Runs on a fresh database after 0001–0005.
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','admin@gardian.com'),('00000000-0000-0000-0000-00000000000b','eng@gardian.com'),
 ('00000000-0000-0000-0000-00000000000c','tech@gardian.com'),('00000000-0000-0000-0000-00000000000d','ops@gardian.com'),
 ('00000000-0000-0000-0000-00000000000e','rd@gardian.com'),('00000000-0000-0000-0000-00000000000f','pm@gardian.com');
insert into tr_members(user_id,email,full_name,role) values
 ('00000000-0000-0000-0000-00000000000a','admin@gardian.com','Anton Ermakov','admin'),
 ('00000000-0000-0000-0000-00000000000b','eng@gardian.com','Ed Engineer','engineer'),
 ('00000000-0000-0000-0000-00000000000c','tech@gardian.com','Tina Tech','tech_director'),
 ('00000000-0000-0000-0000-00000000000d','ops@gardian.com','Oscar Ops','ops_director'),
 ('00000000-0000-0000-0000-00000000000e','rd@gardian.com','Joe Meckler','requester'),
 ('00000000-0000-0000-0000-00000000000f','pm@gardian.com','Pat Plant','plant_manager');
create function pg_temp.u(x text) returns void language sql as $$ select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000'||x,false) $$;
create function pg_temp.fails(q text, label text) returns void language plpgsql as $$
begin execute q; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
exception when others then if sqlerrm like 'EXPECTED FAILURE%' then raise; end if; raise notice 'ok (blocked) %: %', label, sqlerrm; end $$;
create function pg_temp.st() returns text language sql as $$ select status||' acks='||(select string_agg(k,',' order by tr_step_no(k)) from jsonb_object_keys(acks) k) from tr_reports where id='11111111-1111-1111-1111-111111111111' $$;
set role authenticated;

-- 1 Draft (R&D)
select pg_temp.u('e');
insert into tr_reports(id,title,requester_name,request_date) values ('11111111-1111-1111-1111-111111111111','Route test','Joe Meckler','2026-11-24') returning id;
insert into tr_trials(report_id,position,line,line_no,conditions) values
 ('11111111-1111-1111-1111-111111111111',0,'tp','2','[{"name":"Base","mat":"PET"},{"name":"Hot"}]'),
 ('11111111-1111-1111-1111-111111111111',1,'sg',null,'[{"name":"Magnet A"}]');
select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','');
with u as (update tr_reports set title='x' where id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as rd_edit_in_settings_should_be_0 from u;

-- 2 Settings (Engineering)
select pg_temp.u('b');
select pg_temp.fails($q$select tr_transition('11111111-1111-1111-1111-111111111111','advance','')$q$,'settings empty');
update tr_trials set conditions='[{"name":"Base","speed":"120"},{"name":"Hot","speed":"120","hc_psi":"65"}]' where position=0;
update tr_trials set conditions='[{"name":"Magnet A","mag":"Yes"}]' where position=1;
select pg_temp.fails($q$update tr_reports set request_date='2026-11-25' where id='11111111-1111-1111-1111-111111111111'$q$,'date change after draft');
select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','Settings from PET plan');
with u as (update tr_trials set crew='x' returning 1) select count(*) as eng_edit_in_ops_review_should_be_0 from u;

-- 3 Ops review
select pg_temp.u('c');
select pg_temp.fails($q$select tr_transition('11111111-1111-1111-1111-111111111111','advance','')$q$,'tech before ops');
select pg_temp.u('d');
select status, sign_ops->>'decision' from tr_transition('11111111-1111-1111-1111-111111111111','advance','Use 2nd shift');
-- 4 Tech: send back to previous (ops) -> ops sign-off cleared
select pg_temp.u('c');
select pg_temp.fails($q$select tr_transition('11111111-1111-1111-1111-111111111111','send_back','')$q$,'send back w/o comment');
select status, sign_ops is null as ops_cleared from tr_transition('11111111-1111-1111-1111-111111111111','send_back','Check disposition','previous');
select pg_temp.st();
select pg_temp.u('d'); select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','');
select pg_temp.u('c'); select status, sign_tech->>'name' from tr_transition('11111111-1111-1111-1111-111111111111','advance','');

-- 5 Scheduling (Plant Manager)
select pg_temp.u('f');
select pg_temp.fails($q$select tr_transition('11111111-1111-1111-1111-111111111111','advance','')$q$,'no dates');
select pg_temp.fails($q$insert into tr_trials(report_id,line) values ('11111111-1111-1111-1111-111111111111','sg')$q$,'add trial at scheduling');
update tr_trials set planned_date='2026-12-02', shift='2nd', crew='Line 2 crew' where report_id='11111111-1111-1111-1111-111111111111';
select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','');

-- 6 Execution (Engineering)
select pg_temp.u('b');
update tr_trials set run_notes='Ran as planned; web wander at 180 ft/min' where position=0;
select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','Samples pulled');
select pg_temp.fails($q$select tr_transition('11111111-1111-1111-1111-111111111111','send_back','x')$q$,'engineer acting on testing step');

-- 7 Testing (R&D) -> 8 Closed
select pg_temp.u('e');
update tr_reports set data = data || '{"after":{"summary":"Window found at 65 psi"}}' where id='11111111-1111-1111-1111-111111111111';
select status from tr_transition('11111111-1111-1111-1111-111111111111','advance','Package sent');
select pg_temp.st();
with u as (update tr_reports set title='x' where id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as edit_closed_should_be_0 from u;
select kind, from_status, to_status, actor_name from tr_activity where report_id='11111111-1111-1111-1111-111111111111' order by id;

-- Send straight back to the requester from Final approval
insert into tr_reports(id,title,requester_name) values ('22222222-2222-2222-2222-222222222222','Second','Joe Meckler');
insert into tr_trials(report_id,line,conditions) values ('22222222-2222-2222-2222-222222222222','sg','[{"name":"A","mag":"No"}]');
select tr_transition('22222222-2222-2222-2222-222222222222','advance','') is not null;
select pg_temp.u('b'); select tr_transition('22222222-2222-2222-2222-222222222222','advance','') is not null;
select pg_temp.u('d'); select tr_transition('22222222-2222-2222-2222-222222222222','advance','') is not null;
select pg_temp.u('c'); select status, acks = '{}'::jsonb as acks_cleared, sign_ops is null as ops_cleared
  from tr_transition('22222222-2222-2222-2222-222222222222','send_back','Rethink goals','requester');
select pg_temp.u('d'); select pg_temp.fails($q$select tr_transition('22222222-2222-2222-2222-222222222222','cancel','')$q$,'non-author cancel');
select pg_temp.u('e'); select status from tr_transition('22222222-2222-2222-2222-222222222222','cancel','');
reset role;
select 'ROUTE TESTS PASSED';
