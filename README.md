# Flokey — self-hosted client content suite

Replaces the Google Apps Script + Google Sheet version. It runs as a Node.js app on cPanel at **https://app.arjunkarki1.com.np**.

| Piece | Before | Now |
|---|---|---|
| Frontend | `Index.html` served by Apps Script | React app in `web/`, built into `public/app` |
| Backend | `Code.gs` → `google.script.run.api()` | `server.js` + `lib/handlers.js` → `POST /api/rpc` |
| Startup file for cPanel | — | `app.cjs` |
| Database | Google Sheet tabs | Supabase Postgres (`supabase/schema.sql`) |
| Media and invoice PDFs | Google Drive | Supabase Storage (`assets` bucket). Old Drive files keep working. |
| Email | `MailApp` | A cPanel mailbox over SMTP (nodemailer); Resend also supported |
| Invoice PDF | Drive HTML→PDF conversion | `pdf-lib` (`lib/pdf.js`) |

**Access:**
- **Team:** email and password sign-in with Admin, Account Manager or Designer roles.
- **Clients:** "anyone with the link" portal URLs (`/?t=<64-char token>`), which you can create, rotate or turn off per client.

## Pages

- `/`: landing page (`public/landing.html`) with an animated hero and a light/dark toggle. **Get started** goes to `/app`.
- `/app`: the React app (`public/app`, built from `web/`): team sign-in, workspace, and client portals (`/app?t=<token>`). If `public/app` is missing, the old `public/index.html` is served instead.
- Old portal links (`/?t=<token>`) redirect to `/app?t=<token>`.

## Design

The app and homepage use an Apple-style look: the system font (San Francisco on Apple devices, Inter elsewhere), frosted top bars, soft shadows instead of borders, large rounded corners and Apple's blue and grays. Light and dark themes follow the device unless changed with the theme button. All colours are tokens at the top of `web/src/styles.css`.

## Update 6: projects, tasks and time (run `supabase/006_projects_time.sql` once)

- **Projects** (sidebar → Projects): a piece of work for a client or sub-client, with a status, dates, a lead and a budget (budget visible to Admins and Account Managers only).
- **Tasks** on each project's board (To do, In progress, Review, Done). Drag to move, assign people, add due dates and hour estimates.
- **Time tracking is off by default.** Switch it on per client in **Client settings → Time tracking**. Only then do that client's projects show a timer and **Log time** (`1:30`, `1.5` or `90m`), and the **Time** page appears in the sidebar once any client uses it.
- **Time page:** a weekly timesheet for you or anyone on the team.
- **Invoice hours:** turns billable, not-yet-invoiced hours for a main client and its sub-clients into a draft invoice, with one line per project. Those hours are then locked; deleting the invoice unlocks them.
- **Overview** shows *My tasks* and projects due in the next two weeks; client pages list their open projects.

## Update 5: other agencies can sign up (run `supabase/005_workspaces.sql` once)

- **Workspaces:** each agency that signs up gets its own private workspace. Your existing data becomes the first one (`ws_main`) on the unlimited `owner` plan. The server limits every database read and write to the signed-in agency's workspace (`lib/db.js`).
- **Sign-up:** `/app#/signup`, with email and password (confirmed with an emailed code) or **Sign in with Google** (needs `GOOGLE_CLIENT_ID`).
- **Free trial and plans:** new workspaces get a 14-day trial with Growth limits. Plans, prices and limits live in `lib/plans.js`, which feeds the homepage pricing, Settings → Plan, and the limits.
- **When a trial ends**, the workspace becomes read-only (sign-in and viewing still work, nothing is deleted) until a plan is set.
- **Payments are not built yet.** Admins click **Request plan**, which emails `PLATFORM_EMAIL`. To activate a plan: Supabase → **Table Editor** → `workspaces` → set `plan` to `starter`, `growth` or `agency` (or `owner` for unlimited, `paused` to freeze).
- One email address can belong to one workspace.

### Google sign-in setup

1. Go to https://console.cloud.google.com → create a project → **APIs & Services** → **OAuth consent screen**: choose External, fill in the app name and your email, and publish it.
2. **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
3. Under **Authorised JavaScript origins**, add `https://app.arjunkarki1.com.np`. No redirect URI is needed.
4. Copy the **Client ID** into cPanel as `GOOGLE_CLIENT_ID`, then restart.

## Update 4: React app (run `supabase/004_board_columns_comment_images.sql` once)

- **Live updates:** changes show up for the team and for open client links without refreshing. This uses a built-in event stream, with Supabase Realtime as an optional extra (set `SUPABASE_ANON_KEY`).
- **Summary panel** on the right of the calendar, board and table, for both the team and clients. Hide or show it with the panel button.
- **Client portal:** main client and sub-clients in a sidebar, a task dashboard, Calendar, Board and Invoices.
- **Invoices in the portal:** **Send** publishes the invoice to the client's portal and emails it if the client has an email address.
- **Custom board columns per sub-client:** **Add column** on the board. Each column sits after one of the core stages.
- **Images in comments**, for clients and the team.
- **Collapsible client list**, icons only (no emoji), and a new design system with light and dark themes.

## Features added in update 2 (run `supabase/002_features.sql` once)

- **Client links with edit access:** each share link is either *View & approve* or *Add & edit*. With edit access, clients can add posts, upload media, and edit posts until they're Scheduled. They can delete only posts they added.
- **Who added / last updated:** shown on every post, in the editor, the board and the table.
- **Reorder & color-code clients:** Admins and Account Managers use **↕ Reorder** in the sidebar and pick a color in client settings.
- **Tag library:** Settings → Tags. Library tags become one-click chips on posts, and renaming a tag updates every post that uses it.
- **Profile settings:** name, job title, phone, photo, password, and "sign out other devices".
- **Email sign-in codes:** the first sign-in on a new browser or phone needs a 6-digit code sent to the user's email. The device is then trusted for 30 days. If email isn't configured, codes are skipped so nobody gets locked out. Set `DISABLE_LOGIN_CODES=true` to turn codes off on purpose.
- **Password eye buttons, mobile layout** (slide-out client list, full-screen editors, swipeable board), **animations** (respect "reduce motion"), and **dark mode** everywhere.

## Files

- On the server: `app.cjs`, `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/`.
- `.github/workflows/deploy.yml` — uploads those to cPanel automatically on every change.
- `supabase/schema.sql` — run once in the Supabase SQL Editor.
- `migration/exportForMigration.gs` + `scripts/import-sheet-export.js` — move data from the old Sheet.
- `env.example` — every setting the app reads.

## Settings (cPanel → Setup Node.js App → Environment variables)

| Name | Example |
|---|---|
| `SUPABASE_URL` | `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (server-only) |
| `APP_URL` | `https://app.arjunkarki1.com.np` |
| `APP_TIMEZONE` | `Asia/Kathmandu` |
| `SETUP_CODE` | long random string; only used to create the first Admin |
| `SMTP_HOST` | `mail.arjunkarki1.com.np` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `noreply@arjunkarki1.com.np` |
| `SMTP_PASS` | that mailbox's password |
| `MAIL_FROM` | `Client Suite <noreply@arjunkarki1.com.np>` |

After changing any setting, click **Restart** on the app in cPanel.

## Checking it works

Open `https://app.arjunkarki1.com.np/api/health`. It shows whether the database and email settings were picked up. It never shows secrets.

## Node version

Use **Node 20 or newer**. `@supabase/supabase-js` is pinned to 2.109.0, the newest release that still supports Node 20.

## Updating the app (automatic deploy)

Every commit to `main` runs **Deploy to cPanel** (`.github/workflows/deploy.yml`). It uploads only the changed app files over FTPS to `/home/dwaarxco/client-suite`, and touches `tmp/restart.txt` so the app restarts.

- **Edit on GitHub:** open a file → ✏️ → paste → **Commit changes**. It goes live in about a minute; watch it in the **Actions** tab.
- **Frontend changes** (`web/src/...`) are rebuilt by the deploy automatically, then show after a page refresh.
- **Server changes** (`server.js`, `lib/`) need the restart. If one doesn't show, click **Restart** in Setup Node.js App.
- **If `package.json` changed**, click **Run NPM Install** and then **Restart** in cPanel.
- **Database changes** (new tables or columns) must be run in Supabase → SQL Editor *before* committing the code that uses them.
- **Undo:** in GitHub, open the commit and revert it, or paste back the old file. The deploy then runs again with the old code.

One-time setup: create a cPanel FTP account whose directory is `client-suite`. Then add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `FTP_SERVER` | `ftp.arjunkarki1.com.np` |
| `FTP_USERNAME` | e.g. `deploy@arjunkarki1.com.np` |
| `FTP_PASSWORD` | that FTP account's password |

## Running on your own computer

```bash
cp env.example .env   # fill in values
npm install
npm start              # http://localhost:3000
```

To work on the screens with instant reload: `cd web && npm install && npm run dev` (opens on port 5173 and forwards `/api` to the server on 4321). `npm run build` writes `public/app`.

To try everything without Supabase or email, run `node dev/preview.mjs` and open http://localhost:4321. It uses in-memory data that is lost when it stops.

## Moving data from the old Sheet

1. Paste `migration/exportForMigration.gs` at the bottom of `Code.gs` and run `exportForMigration`. The log links to a JSON file in Drive.
2. Download it, then run `npm run import-sheet -- path/to/export.json` with `.env` filled in.
3. Team passwords keep working; they're upgraded to scrypt on first sign-in. Client link tokens are kept, so only the domain part of each link changes.
4. Delete the export JSON afterwards. It contains password hashes.

## Known limitations

- **Pasted Google Drive links:** the file must be shared as "Anyone with the link".
- **Invoice PDFs** use standard fonts, so non-Latin text (e.g. Devanagari) prints as `?`.
