\set ON_ERROR_STOP on
-- users
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','admin@gardian.com'),
 ('00000000-0000-0000-0000-00000000000b','joe@gardian.com'),
 ('00000000-0000-0000-0000-00000000000c','tech@gardian.com'),
 ('00000000-0000-0000-0000-00000000000d','ops@gardian.com'),
 ('00000000-0000-0000-0000-00000000000e','req@gardian.com'),
 ('00000000-0000-0000-0000-00000000000f','other@gardian.com');
insert into tr_members(user_id,email,full_name,role) values
 ('00000000-0000-0000-0000-00000000000a','admin@gardian.com','Anton Ermakov','admin'),
 ('00000000-0000-0000-0000-00000000000b','joe@gardian.com','Joe Meckler','engineer'),
 ('00000000-0000-0000-0000-00000000000c','tech@gardian.com','Tina Tech','tech_director'),
 ('00000000-0000-0000-0000-00000000000d','ops@gardian.com','Oscar Ops','ops_director'),
 ('00000000-0000-0000-0000-00000000000e','req@gardian.com','Rita Requester','requester'),
 ('00000000-0000-0000-0000-00000000000f','other@gardian.com','Other Requester','requester');

create function pg_temp.as_user(u text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000'||u, false) $$;
create function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin execute q; raise exception 'EXPECTED FAILURE DID NOT HAPPEN: %', label;
exception when others then
  if sqlerrm like 'EXPECTED FAILURE%' then raise; end if;
  raise notice 'ok (blocked) %: %', label, sqlerrm; end $$;

set role authenticated;
-- Joe (engineer) creates a report with 3 trials
select pg_temp.as_user('b');
insert into tr_reports(id,title,requester_name,request_date) values
 ('11111111-1111-1111-1111-111111111111','PET film coating trial','Joe Meckler','2026-11-24') returning id;
-- what the app does: insert and read the id back (failed before 0003)
insert into tr_reports(title,requester_name) values ('Returning test','Rita Requester') returning title;
insert into tr_trials(report_id,position,line,line_no) values
 ('11111111-1111-1111-1111-111111111111',0,'tp','2'),
 ('11111111-1111-1111-1111-111111111111',1,'tp','5'),
 ('11111111-1111-1111-1111-111111111111',2,'psa',null);
select position, trial_no from tr_trials where report_id='11111111-1111-1111-1111-111111111111' order by position;

-- Rita (requester) makes a separate report the same day -> next number
select pg_temp.as_user('e');
insert into tr_reports(id,title,requester_name,request_date) values
 ('22222222-2222-2222-2222-222222222222','Shock-Gard riser trial','Rita Requester','2026-11-24') returning id;
insert into tr_trials(report_id,line) values ('22222222-2222-2222-2222-222222222222','sg');
select trial_no from tr_trials where report_id='22222222-2222-2222-2222-222222222222';
-- a requester can't see Joe's draft
select count(*) as rita_sees_joe_draft from tr_reports where id='11111111-1111-1111-1111-111111111111';
-- requester can't change status directly
select pg_temp.expect_fail($q$update tr_reports set status='approved' where id='22222222-2222-2222-2222-222222222222'$q$,'direct status change');

-- Joe removes trial 2 (TG5): gap stays; adds a new SG trial -> gets 05
select pg_temp.as_user('b');
delete from tr_trials where report_id='11111111-1111-1111-1111-111111111111' and position=1;
insert into tr_trials(report_id,position,line) values ('11111111-1111-1111-1111-111111111111',3,'sg');
-- changing line keeps number ending
update tr_trials set line_no='3' where report_id='11111111-1111-1111-1111-111111111111' and position=0;
select position, trial_no from tr_trials where report_id='11111111-1111-1111-1111-111111111111' order by position;

-- next day -> 01 again
insert into tr_reports(id,title,requester_name,request_date) values
 ('33333333-3333-3333-3333-333333333333','Next day','Joe Meckler','2026-11-25');
insert into tr_trials(report_id,line,line_no) values ('33333333-3333-3333-3333-333333333333','tp','1');
select trial_no from tr_trials where report_id='33333333-3333-3333-3333-333333333333';
-- moving its request date to 11-24 renumbers into that day's sequence
update tr_reports set request_date='2026-11-24' where id='33333333-3333-3333-3333-333333333333';
select trial_no from tr_trials where report_id='33333333-3333-3333-3333-333333333333';

-- Workflow
select pg_temp.expect_fail($q$select tr_transition('11111111-1111-1111-1111-111111111111','approve','')$q$,'engineer approving');
select status from tr_transition('11111111-1111-1111-1111-111111111111','submit','');
with u as (update tr_reports set title='x' where id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as edited_after_submit_should_be_0 from u;
with u as (update tr_trials set crew='x' where report_id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as trial_edits_after_submit_should_be_0 from u;
select pg_temp.as_user('d');
select pg_temp.expect_fail($q$select tr_transition('11111111-1111-1111-1111-111111111111','approve','')$q$,'ops before tech');
select pg_temp.as_user('c');
select pg_temp.expect_fail($q$select tr_transition('11111111-1111-1111-1111-111111111111','send_back','')$q$,'send back w/o comment');
select status, sign_tech->>'decision' from tr_transition('11111111-1111-1111-1111-111111111111','approve','Run condition B first');
select pg_temp.as_user('d');
select status from tr_transition('11111111-1111-1111-1111-111111111111','send_back','Need crew names');
select pg_temp.as_user('c');
select status, sign_tech is null as tech_sig_cleared from tr_reports where id='11111111-1111-1111-1111-111111111111';
select status from tr_transition('11111111-1111-1111-1111-111111111111','approve','');
select pg_temp.as_user('d');
select status, sign_ops->>'name' from tr_transition('11111111-1111-1111-1111-111111111111','approve','');
-- requesters can now see the approved report read-only, but not comment
select pg_temp.as_user('f');
select count(*) as other_sees_approved from tr_reports where id='11111111-1111-1111-1111-111111111111';
select pg_temp.expect_fail($q$select tr_comment('11111111-1111-1111-1111-111111111111','hi')$q$,'non-owner requester comment');
select pg_temp.as_user('b');
select kind from tr_comment('11111111-1111-1111-1111-111111111111','Material staged at Line 7');
select status from tr_transition('11111111-1111-1111-1111-111111111111','complete','All rolls tagged R&D HOLD');
select kind, from_status, to_status, actor_name from tr_activity where report_id='11111111-1111-1111-1111-111111111111' order by id;
select title, status, jsonb_array_length(trials) from tr_report_list order by created_at;
-- delete rules
with d as (delete from tr_reports where id='11111111-1111-1111-1111-111111111111' returning 1) select count(*) as engineer_deleted_should_be_0 from d;
select pg_temp.as_user('a');
with d as (delete from tr_reports where id='33333333-3333-3333-3333-333333333333' returning 1) select count(*) as admin_deleted_should_be_1 from d;
reset role;
select 'ALL TESTS PASSED';
