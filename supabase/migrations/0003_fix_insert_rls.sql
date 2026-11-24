-- Fix: "new row violates row-level security policy for table tr_reports" on Save.
-- The app inserts a new report and reads its id back in the same statement.
-- The read policy looked the row up again by id, and a brand-new row isn't
-- visible to that lookup yet, so the read-back was refused. The policy now
-- checks the row's own columns instead. Same rules, no data changes.
drop policy if exists tr_reports_read on public.tr_reports;
create policy tr_reports_read on public.tr_reports for select to authenticated
  using (
    public.tr_role() in ('engineer','tech_director','ops_director','admin','spectator')
    or created_by = auth.uid()
    or (public.tr_role() = 'requester' and status in ('approved','completed'))
  );
