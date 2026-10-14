# Client Operations & Content Suite — self-hosted version

Replaces the Google Apps Script + Google Sheet version. It runs as a Node.js app on cPanel at **https://app.arjunkarki1.com.np**.

| Piece | Before | Now |
|---|---|---|
| Frontend | `Index.html` served by Apps Script | `public/index.html` (same UI) |
| Backend | `Code.gs` → `google.script.run.api()` | `server.js` + `lib/handlers.js` → `POST /api/rpc` |
| Startup file for cPanel | — | `app.cjs` |
| Database | Google Sheet tabs | Supabase Postgres (`supabase/schema.sql`) |
| Media and invoice PDFs | Google Drive | Supabase Storage (`assets` bucket). Old Drive files keep working. |
| Email | `MailApp` | A cPanel mailbox over SMTP (nodemailer); Resend also supported |
| Invoice PDF | Drive HTML→PDF conversion | `pdf-lib` (`lib/pdf.js`) |

**Access:**
- **Team:** email and password sign-in with Admin, Account Manager or Designer roles.
- **Clients:** "anyone with the link" portal URLs (`/?t=<64-char token>`), which you can create, rotate or turn off per client.

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
- **Frontend changes** (`public/index.html`) show immediately after the upload, because the server reads the file on every request.
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

## Moving data from the old Sheet

1. Paste `migration/exportForMigration.gs` at the bottom of `Code.gs` and run `exportForMigration`. The log links to a JSON file in Drive.
2. Download it, then run `npm run import-sheet -- path/to/export.json` with `.env` filled in.
3. Team passwords keep working; they're upgraded to scrypt on first sign-in. Client link tokens are kept, so only the domain part of each link changes.
4. Delete the export JSON afterwards. It contains password hashes.

## Known limitations

- **Pasted Google Drive links:** the file must be shared as "Anyone with the link".
- **Invoice PDFs** use standard fonts, so non-Latin text (e.g. Devanagari) prints as `?`.
