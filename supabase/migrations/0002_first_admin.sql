-- Run once after 0001, with your own email, to make yourself the first
-- Trial Reports admin. Uses your existing Load Diagram Tool account.
-- After that, add everyone else from the app's Users page.
insert into public.tr_members (user_id, email, full_name, role)
select id, email, 'Anton Ermakov', 'admin' from auth.users where lower(email) = lower('aermakov@gardian.com')
on conflict (user_id) do update set role = 'admin', active = true;
