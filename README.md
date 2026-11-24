# Gardian Trial Reports

R&D pre-trial reports for the Ty-Gard® coating lines (1, 2, 3, 5), the PSA line (Line 7) and the Shock-Gard® Line, stored in a database with status, dates, trial numbers, sign-offs and a full Activity log.

It is built the same way as the Load Diagram Tool, and looks and works like it:

- **Front end:** plain HTML, CSS and JavaScript on GitHub Pages. No build step.
- **Back end:** the Load Diagram Tool's own Supabase project. It uses the same sign-in (email code or Microsoft), the same people and Resend for email. All its tables are prefixed `tr_`, so nothing touches the Load Diagram Tool's data.
- **Look:** LDT tokens, outline buttons, underlined fields, the Documents-style list with "Needs your attention", an editor with a sidebar and a sheet, one status button that turns into the approval menu, and the Activity panel.

## How a report moves

Reports follow the 8-step route in the *R&D Trial Report Routing Roadmap* (Nov 24, 2026). Each step has one owner. The owner fills in their part of the form, then hands the report to the next person with one button. The report's status always shows which step it's at and who it's waiting on.

| # | Step | Owner | Fills in | Hand-off button |
|---|---|---|---|---|
| 1 | Draft | Trial Requester (R&D) | Report info, background, goals, trials (line and line number), condition names, testing, samples, delivery, disposition | Send to Engineering |
| 2 | Settings Entry | Engineering | Line settings for every condition of every trial | Send to Director of Operations |
| 3 | Operations Review | Director of Operations | Reviews; sign-off | Approve – Send to Director of Technology |
| 4 | Final Approval | Director of Technology | Reviews; sign-off | Final Approval – Send to Plant Manager |
| 5 | Scheduling | Plant Manager | Planned date, shift, duration, crew for each trial | Schedule Set – Send to Engineering |
| 6 | Execution | Engineering | Run notes, settings as run, condition notes and disposition | Trials Run – Send to R&D |
| 7 | Testing | R&D | Test results, samples shipped, after-trial package | Close & Send After-Trial Package |
| 8 | Closed | — | Read-only. The package is emailed to the Director of Technology, the engineer who ran the trial, the Plant Manager and the Director of Operations | — |

- **Send back:** at any step, the owner can send the report back to the previous owner or straight to the requester, with a required comment. Sign-offs from that point on are cleared, so they're redone.
- **Every hand-off is recorded** with the person's name, the time and an optional comment. These show in the sidebar Route list, in the Route & Sign-offs section and in the Activity log. The two director approvals are the sign-offs; nobody types a signature.
- **Checks before a hand-off:** Draft needs a title, a requester and a line for every trial. Settings Entry needs settings for every condition. Scheduling needs a planned date for every trial.
- **Fields are locked by step.** Only the current owner can edit, and only their own sections. The database enforces who can edit at each step; the app limits each step to its own sections.
- Admins can act at any step. The report's author or an admin can cancel it.

## Roles

| Role | Owns |
|---|---|
| R&D (Trial Requester) | Draft and Testing |
| Engineering | Settings Entry and Execution |
| Director of Operations | Operations Review |
| Director of Technology | Final Approval |
| Plant Manager | Scheduling |
| Admin | Any step, plus Users and deleting reports |
| Spectator | Sees everything and comments |

Everyone with a role sees every report. Someone removed in the Load Diagram Tool loses access here too.

## Trial numbers

The format is `LINE-INITIALS-MMDDYY-NN`, for example `TG2-JM-112426-01`.

- **LINE** is TG1, TG2, TG3 or TG5 for the Ty-Gard lines, L7 for the PSA line and SG for the Shock-Gard Line.
- **INITIALS** come from "Requested By", and **MMDDYY** is the request date.
- **NN** is assigned by the database when the report is saved. It counts every trial requested on that date across all reports, so numbers are always unique. It is never reused, so a removed trial leaves a gap.

## Printing and PDFs

**Print / PDF** under the report opens the browser's print dialog, set up for US Letter (8.5 × 11 in, 0.5 in margins). Choose *Save as PDF* to get a file; its suggested name is the trial numbers and report title.

- Each trial starts on a new page. A trial with more than four conditions prints on landscape Letter, so its settings table stays readable.
- Every page has a footer with page X of Y. Text boxes grow to fit what was typed, and empty hints and date masks are left off the paper.
- The PDF has real text, not an image, so it can be searched and copied from.

## One-time setup

1. **Database.** In the Supabase SQL Editor (project `ptjzayeynuesvcjrtunb`), run the files in `supabase/migrations/` in order: `0001` (tables), `0002` (makes you the first admin; check the email first), `0003` (save fix), `0004` (Add User) and `0005` (the 8-step route). All are safe to re-run.
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

- **Database rules:** `supabase/tests/run.sh` builds scratch Postgres 16 databases with a minimal stand-in for Supabase auth. It runs `test_0001.sql` (numbering, edit locks, delete rules) and `test_0005.sql`, which walks a report through all 8 steps, including send-backs, the checks before each hand-off and who can act at each step.
- **Demo page:** `node scripts/build-demo.mjs` (needs `esbuild`) writes the single-file demo to `dist/demo.html`.

## Files

```
index.html                  screens: sign-in, Reports list, editor, Users, Activity panel
styles.css                  LDT styles plus the trial sheet, line cards and settings table
src/app.js                  app logic: routing, list, editor, approvals, Activity, Users, copy/export
src/lines.js                line definitions (stations and settings per line) and line drawings
src/route.js                the 8-step route: owners, hand-off labels, which sections each step fills in
src/api-supabase.js         live backend (Supabase)
src/api-demo.js             demo backend (browser storage, same rules)
src/config.js               Supabase URL and public anon key (same as the LDT)
supabase/migrations/        tables, numbering, roles, row-level security, actions, grants
supabase/functions/         trial-notify (emails), trial-invite (add users)
supabase/tests/             local SQL tests
```
