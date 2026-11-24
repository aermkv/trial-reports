-- Lets an admin add someone who already has an account (anyone who signs in to
-- the Load Diagram Tool) straight from the Users page, with no edge function.
-- Only brand-new people still need the trial-invite function to email an invite.
create or replace function public.tr_add_member(p_email text, p_name text, p_role text)
returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid; existed boolean;
begin
  if public.tr_role() is distinct from 'admin' then raise exception 'Only admins can manage users.'; end if;
  if p_role not in ('requester','engineer','tech_director','ops_director','admin','spectator') then raise exception 'Unknown role.'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then return jsonb_build_object('found', false); end if;
  select exists (select 1 from public.tr_members where user_id = uid) into existed;
  insert into public.tr_members (user_id, email, full_name, role, active)
  values (uid, lower(trim(p_email)), coalesce(nullif(trim(p_name), ''), ''), p_role, true)
  on conflict (user_id) do update
    set role = excluded.role, active = true,
        full_name = coalesce(nullif(trim(p_name), ''), public.tr_members.full_name);
  return jsonb_build_object('found', true, 'restored', existed);
end $$;
revoke execute on function public.tr_add_member(text, text, text) from public, anon;
grant execute on function public.tr_add_member(text, text, text) to authenticated;
