# Gardian Trial Reports

R&D pre-trial reports for the Ty-Gard® coating lines (1, 2, 3, 5), the PSA line (Line 7) and the Shock-Gard® Line, stored in a database with status, dates, trial numbers, sign-offs and a full Activity log.

It is built the same way as the Load Diagram Tool, and looks and works like it:

- **Front end:** plain HTML, CSS and JavaScript on GitHub Pages. No build step.
- **Back end:** the Load Diagram Tool's own Supabase project. It uses the same sign-in (email code or Microsoft), the same people and Resend for email. All its tables are prefixed `tr_`, so nothing touches the Load Diagram Tool's data.
- **Look:** LDT tokens, outline buttons, underlined fields, the Documents-style list with "Needs your attention", an editor with a sidebar and a sheet, one status button that turns into the approval menu, and the Activity panel.

## How a report moves

| Status | Waiting on | Who can act |
|---|---|---|
| Draft (or Sent Back / Recalled / Reopened) | The author | Author or R&D edits and submits |
| Pending Technology Approval | Director of Technology | Approve, approve with comments, send back to the author. The author can recall it. |
| Pending Operations Approval | Director of Operations | Approve (final), approve with comments, send back to Technology. Technology can recall it. |
| Approved | R&D (run the trial) | Author or R&D marks it completed. Technology can reopen it for edits, which clears both sign-offs. |
| Completed / Cancelled | — | Read-only, with history kept |

Send-backs go one step back, as in the Load Diagram Tool. The sign-off section is filled in by these approvals with the director's name, decision, time and comment. There are no typed signatures. The database enforces every rule, and the app only mirrors them.

## Roles

| Role | Can |
|---|---|
| Requester | Create reports, edit their own drafts, comment on their own reports, and open every approved or completed report read-only |
| R&D Engineer | Create reports, edit or submit any draft, mark trials completed, see everything |
| Director of Technology | First sign-off; reopen approved reports |
| Director of Operations | Final sign-off |
| Admin | Everything, including Users and deleting reports |
| Spectator | See everything and comment. Emailed on final approvals and completions |

Someone removed in the Load Diagram Tool loses access here too.

## Trial numbers

The format is `LINE-INITIALS-MMDDYY-NN`, for example `TG2-JM-112426-01`.

- **LINE** is TG1, TG2, TG3 or TG5 for the Ty-Gard lines, L7 for the PSA line and SG for the Shock-Gard Line.
- **INITIALS** come from "Requested By", and **MMDDYY** is the request date.
- **NN** is assigned by the database when the report is saved. It counts every trial requested on that date across all reports, so numbers are always unique. It is never reused, so a removed trial leaves a gap.

## One-time setup

1. **Database.** In the Supabase SQL Editor (project `ptjzayeynuesvcjrtunb`), run `supabase/migrations/0001_trial_reports.sql`, then `0002_first_admin.sql`. The second one makes you the first admin; check the email address in it first. Both are safe to re-run.
2. **Email functions.** From this folder, run:
   ```
   supabase functions deploy trial-notify trial-invite --project-ref ptjzayeynuesvcjrtunb
   ```
   They use the project's existing `RESEND_API_KEY` secret. The sender is `notifications@notifications.gardian.com` unless you set a `TRIAL_EMAIL_FROM` secret.
3. **Sign-in redirect.** In Supabase, go to Authentication → URL Configuration and add `https://aermkv.github.io/trial-reports/` to Redirect URLs. Microsoft sign-in and email links need it.
4. **Hosting.** Create the GitHub repo `aermkv/trial-reports`, push this folder and turn on GitHub Pages (main branch, root).
5. **People.** Sign in, open Menu → Users and add people with a role. Anyone who already uses the Load Diagram Tool is added straight away with their existing account. Anyone new gets a Supabase invitation email.

## Try it without the database

Open `index.html?demo=1` from any local web server, or the published demo page. You sign in as sample people (requester, R&D, both directors, admin, spectator). Everything is saved in that browser only.

## Testing

- **Database rules:** `supabase/tests/run.sh` builds a scratch Postgres 16 database with a minimal stand-in for Supabase auth and runs `test_0001.sql`. That file tests numbering, roles, every status change, edit locks and delete rules.
- **Demo page:** `node scripts/build-demo.mjs` (needs `esbuild`) writes the single-file demo to `dist/demo.html`.

## Files

```
index.html                  screens: sign-in, Reports list, editor, Users, Activity panel
styles.css                  LDT styles plus the trial sheet, line cards and settings table
src/app.js                  app logic: routing, list, editor, approvals, Activity, Users, copy/export
src/lines.js                line definitions (stations and settings per line) and line drawings
src/api-supabase.js         live backend (Supabase)
src/api-demo.js             demo backend (browser storage, same rules)
src/config.js               Supabase URL and public anon key (same as the LDT)
supabase/migrations/        tables, numbering, roles, row-level security, actions, grants
supabase/functions/         trial-notify (emails), trial-invite (add users)
supabase/tests/             local SQL tests
```
