# Deploying Reclip on Railway

This is a checklist, in order. Screen names on Railway change from time to time; if a label differs,
look for the closest one and check Railway's current docs. Nothing here contains a secret: put real
values only in Railway's Variables screen, never in the repository.

Plan for about two hours the first time, plus waiting for DNS.

---

## 0. Before you start

| You need | Notes |
| --- | --- |
| A private GitHub repo with this code pushed | `main` is what Railway will deploy |
| A Railway account | Paid plan needed for a real service; check current pricing on railway.com |
| A domain name | e.g. `app.yourdomain.com` |
| An SMTP account that can send from your domain | Needed for sign-up confirmation and password reset emails. Examples: Resend, Postmark, Brevo, Amazon SES, Mailgun |
| An object storage bucket | Cloudflare R2 or AWS S3. Holds uploaded receipts and the backups |
| An Anthropic API key (or OpenAI) | Needed to read **photographed** receipts. Without it, photos are stored but nothing is extracted. It costs money per receipt: price it in |
| A password manager | For the keys below. Losing the backup key means losing every backup |

## 1. Make the secrets (on your own computer)

```powershell
npm run backup -- key
```
Prints a 64-character key. Save it in your password manager as **BACKUP_ENCRYPTION_KEY**, and keep a
second copy somewhere that is not Railway. Without it, backups cannot be opened.

Also make a long random value for **HEALTH_TOKEN** (any 32+ characters from your password manager).

## 2. Create the storage bucket

Cloudflare R2 (recommended: no download fees):
1. Create a bucket, e.g. `reclip-documents`. Keep it **private**.
2. Create an API token with read and write access to that bucket only.
3. Note: bucket name, account ID, access key ID, secret access key.
4. Endpoint: `https://<account-id>.r2.cloudflarestorage.com`, region: `auto`.
5. Turn on versioning or a lifecycle rule if your plan allows (protects uploaded files from accidental deletion).

## 3. Create the Railway project

1. New Project, then **Deploy from GitHub repo**, and pick the repo.
2. In the same project: **Add**, then **Database**, then **PostgreSQL**.
3. Open the web service, then **Variables**, and add everything in section 4.

## 4. Variables on the web service

| Variable | Value | Why |
| --- | --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Reference to the Postgres service (use the service's real name if it differs) |
| `APP_URL` | `https://app.yourdomain.com` | Base of links in emails |
| `TRUSTED_PROXY_HOPS` | `1` (verify in step 8) | How many proxies sit in front of the app |
| `S3_BUCKET` | your bucket name | Documents and backups |
| `S3_REGION` | `auto` (R2) or e.g. `eu-west-1` | |
| `S3_ENDPOINT` | the R2 endpoint (leave out for AWS) | |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from the bucket token | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | from your mail provider | Port 587 or 465 |
| `MAIL_FROM` | `Reclip <no-reply@yourdomain.com>` | Must be a sender your provider allows |
| `SUPPORT_EMAIL` | your billing or support address | Shown in Settings for plan questions |
| `EXTRACTION_PROVIDER` | `anthropic` | Reads photographed receipts |
| `ANTHROPIC_API_KEY` | your key | |
| `SEMANTIC_PROVIDER` | `local` | No extra cost |
| `HEALTH_TOKEN` | from step 1 | Lets your monitor see queue numbers |
| `BACKUP_ENCRYPTION_KEY` | from step 1 | Turns on daily encrypted backups |
| `BACKUP_HOUR_UTC` | `2` | Backups run after this hour |
| `BACKUP_KEEP` | `14` | How many to keep |
| `SENTRY_DSN` | from sentry.io (optional) | Error tracking; personal data is stripped |

You do **not** need `SESSION_SECRET` (the app does not use it). Do not set `STORAGE_DIR` when using a bucket.
Do not set `PORT`; Railway provides it and the app follows it.

## 5. Service settings (Settings tab)

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| **Pre-deploy command** | `npm run db:push` (applies database migrations; if it fails, the deploy stops and the old version keeps running) |
| Start command | `npm start` (the app listens on Railway's `PORT`, on all interfaces) |
| Healthcheck path | `/api/health` |
| Replicas | `1` to begin with |
| Restart policy | On failure |

Railway's `railway.json` config file is deprecated, so these live in the dashboard.

## 6. Domain and HTTPS

1. Service, then Settings, then **Networking**, then **Custom Domain**, and add `app.yourdomain.com`.
2. Add the CNAME record Railway shows at your DNS provider.
3. Wait for the certificate (HTTPS is automatic). Sessions use secure cookies, so login only works over HTTPS.
4. Update `APP_URL` to the final address if you changed it, and redeploy.

## 7. Email that arrives (do not skip)

At your mail provider, add the DNS records it asks for on your domain: **SPF**, **DKIM** and ideally
**DMARC**. Without them, confirmation and reset emails go to spam. After adding them, send a test to a
Gmail and an Outlook address and check the inbox and the spam folder.

## 8. First-run verification (tick every box)

- [ ] `https://app.yourdomain.com/api/health` returns `{"status":"ok", ...}` with status 200
- [ ] The deploy log shows the migration ran (`Database is up to date.`) and no errors
- [ ] Sign up with a real address; the **confirmation email arrives** and the link works
- [ ] Settings, then Recent account activity, shows **your real IP address** (not `unknown` or `local`).
      If it shows `unknown`, set `TRUSTED_PROXY_HOPS` to `2` (a proxy such as Cloudflare is in front) and redeploy.
      This matters: it is what makes login rate limiting work
- [ ] Upload a PDF receipt: it shows "Processing", then finishes
- [ ] Upload a **photo** of a receipt: the merchant, date and total are read
- [ ] Import a bank CSV and check receipts match
- [ ] "Forgot your password": the reset email arrives and works
- [ ] `curl -I https://app.yourdomain.com/login` shows `Content-Security-Policy` and `Strict-Transport-Security`
- [ ] The file appears in your bucket (`<org id>/...`) after an upload
- [ ] Backups: set `BACKUP_HOUR_UTC` to `0` once, redeploy, and confirm a file appears under `backups/` in the bucket
- [ ] **Restore drill:** download that backup file; on your computer run
      `npm run db:push` against a scratch database, then
      `npm run backup -- restore <file>` with the same `BACKUP_ENCRYPTION_KEY`. Check the counts match
- [ ] Delete your test account from Settings and confirm its data and files are gone
- [ ] Look through the logs for anything starting `[api] unhandled error`, `[mail]`, `[queue]`

## 9. After launch

- **Uptime monitor:** point a monitor (UptimeRobot, Better Stack, etc.) at `/api/health`, every minute,
  alerting by email. It goes red if the database is down, jobs are stuck, or no backup exists after 36 hours
- **Sentry:** make sure alerts go to your email
- **Backups:** keep the key copy outside Railway. Redo the restore drill once a quarter
- **Postgres:** enable Railway's own database backups if your plan has them, in addition to ours
- **Updating:** push to `main`; Railway builds, runs the migration, checks health, and switches over
- **Billing (wire transfer):** when a payment arrives, run the plan command against production from your computer:
  1. In Railway, open the Postgres service and copy the **public** connection URL (enable public networking only while you need it; treat the URL as a password)
  2. In PowerShell:
     ```powershell
     $env:DATABASE_URL = "<paste the public URL>"
     npm run plan -- set customer@example.com pro --until 2027-11-02 --ref INV-2026-001
     Remove-Item Env:DATABASE_URL
     ```
  3. Use `npm run plan -- expiring --days 30` monthly to see who needs a renewal invoice

## 10. When something goes wrong

| Symptom | Likely cause |
| --- | --- |
| "Application failed to respond" | The app is not listening on Railway's port. Check the start command is `npm start`, with no `-p` flag |
| Deploy stops at pre-deploy | A migration failed: read the log. The previous version keeps serving |
| `DATABASE_URL must be a postgres:// URL in production` | The variable is missing, or the reference name does not match the Postgres service |
| Receipts stay on "Processing" | The background worker is not running (check `RUN_WORKER` is not `false`) or `/api/health` shows a stuck queue |
| Photos upload but show no data | `EXTRACTION_PROVIDER`/`ANTHROPIC_API_KEY` not set, or out of credit |
| Emails never arrive | SMTP variables wrong or SPF/DKIM missing; check the `[mail]` lines in the log |
| Everyone shares one rate limit, or IPs show `unknown` | `TRUSTED_PROXY_HOPS` is wrong (see step 8) |
| Login works on HTTPS but not on plain HTTP | Expected: session cookies are secure-only |

To roll back: Railway, then Deployments, then pick the last good deployment and redeploy it. Migrations only
add columns and tables, so the older version keeps working with the newer database.
