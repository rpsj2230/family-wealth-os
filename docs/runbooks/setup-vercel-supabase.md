# Runbook — Connect GitHub, Vercel and Supabase

Goal: `main` on GitHub auto-deploys to Vercel; the deployed app talks to your Supabase (Mumbai) project; GitHub Actions can apply database changes. Screen labels can differ slightly as the dashboards change; follow the intent if a label has moved.

**Golden rule:** never paste a key, token or password into chat, Git or an issue. Type or paste them only into the Vercel / GitHub / password-manager fields named below.

```
GitHub repo (rpsj2230/family-wealth-os)
   ├── push to main ───────────► Vercel (builds apps/web, serves the app)
   │                                   └── env vars ──► Supabase (Auth + Postgres)
   └── GitHub Actions ────────────────────────────────► Supabase (apply migrations, daily jobs)
```

## Part A — Collect values from Supabase

Open the project at supabase.com/dashboard → select the Mumbai project.

| # | What | Where | Used for |
|---|---|---|---|
| A1 | **Project reference** (20-letter id) | Project Settings → General → *Reference ID*; also in the dashboard URL `…/project/<ref>` | GitHub secret `SUPABASE_PROJECT_REF` |
| A2 | **Project URL** `https://<ref>.supabase.co` | Project Settings → API (or the **Connect** button at the top) | Vercel `NEXT_PUBLIC_SUPABASE_URL` |
| A3 | **Public key**: *Publishable key* (`sb_publishable_…`) on new projects, or the *anon* key under "Legacy API keys" | Project Settings → API Keys | Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY` (safe for browsers; protected by Row Level Security) |
| A4 | **Secret key**: *Secret key* (`sb_secret_…`) or the *service_role* key | Same page; click reveal | Vercel `SUPABASE_SERVICE_ROLE_KEY` (**server only, never public**) |
| A5 | **Database password** | Project Settings → Database → *Reset database password* if you do not have it. Save it in your password manager | GitHub secret `SUPABASE_DB_PASSWORD` |
| A6 | **Access token** | supabase.com/dashboard/account/tokens → *Generate new token*, name it `fwos-ci` | GitHub secret `SUPABASE_ACCESS_TOKEN` |

## Part B — Connect Vercel to GitHub and import the project

1. **Make sure Vercel is linked to the right GitHub account.** The repo is under **`rpsj2230`**. In Vercel: avatar → *Settings* → *Authentication* (or *Connections*) → check GitHub is connected as `rpsj2230`. If your Vercel login is linked to `rp2230career` instead, see *Troubleshooting* (fallback deploy).
2. Vercel dashboard → **Add New… → Project** → *Import Git Repository*. Select **`rpsj2230/family-wealth-os`**. If it is not listed, click *Adjust GitHub App Permissions* → install/configure the Vercel GitHub App on `rpsj2230` and allow this repository.
3. On the *Configure Project* screen set:
   - **Framework Preset:** Next.js (auto-detected)
   - **Root Directory:** click *Edit* → `apps/web`
   - Tick **"Include source files outside of the Root Directory in the Build Step"** (needed so the shared `packages/core` code is built)
   - Leave Build/Install commands as default (Vercel detects pnpm from the lockfile)
4. Expand **Environment Variables** and add these three (apply to *Production, Preview and Development*):

   | Name | Value | Notes |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | A2 | |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | A3 | |
   | `SUPABASE_SERVICE_ROLE_KEY` | A4 | Tick **Sensitive** so it cannot be read back. Do not add a `NEXT_PUBLIC_` prefix. |

5. Click **Deploy**. When it finishes you get a URL like `https://family-wealth-os-xxxx.vercel.app`.
6. Project → **Settings → General → Node.js Version:** choose **22.x**. **Settings → Git → Production Branch:** `main`. (Environment-variable changes only take effect after a redeploy: *Deployments → ⋯ → Redeploy*.)

## Part C — Point Supabase Auth at the Vercel URL

1. Supabase → **Authentication → URL Configuration**
   - **Site URL:** your Vercel production URL
   - **Redirect URLs:** add `https://<your-project>.vercel.app/**` and `http://localhost:3000/**`. For preview deployments also add the wildcard shown in Vercel's deployment URL pattern, e.g. `https://family-wealth-os-*-<your-vercel-team-slug>.vercel.app/**`.
2. **Authentication → Sign In / Providers → Email:** enable it; keep *Confirm email* on.
3. **Authentication → Users → Add user → Create new user:** create one user for you and one for your wife (email + strong password, tick *Auto Confirm User*).
4. Then **turn off "Allow new users to sign up"** (Authentication → Sign In / Providers, or Settings → Auth). This stops strangers creating accounts.
5. Supabase's built-in email sender is heavily rate-limited; that is fine for two users. Custom SMTP (via the free email provider) will be configured later.

## Part D — Give GitHub Actions what it needs

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**. Add:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | A6 |
| `SUPABASE_DB_PASSWORD` | A5 |
| `SUPABASE_PROJECT_REF` | A1 |

Later phases will ask for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (for the daily NAV, email and backup jobs). I will tell you when.

**Alternative that saves steps:** connect the **Supabase connector** in claude.ai (Settings → Connectors). I can then apply database changes directly from the session. Even so, the GitHub secrets are needed for the scheduled jobs.

## Part E — Verify the connection

1. Open `https://<your-project>.vercel.app/` → you should see the RP logo and "Family Wealth OS".
2. Open `https://<your-project>.vercel.app/api/health`. Expected:
   ```json
   { "ok": true, "env": { "NEXT_PUBLIC_SUPABASE_URL": true, "NEXT_PUBLIC_SUPABASE_ANON_KEY": true, "SUPABASE_SERVICE_ROLE_KEY": true }, "supabase": "reachable" }
   ```
3. Tell me the Vercel URL. I will confirm from my side and tick the plan items P0.5 and P0.6.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `/` and `/api/health` give Vercel's own **404 NOT_FOUND**, but `/brand/rp-logo.png` loads | Vercel deployed the repo root as a plain static site, so Next.js never ran. In *Settings → General* set **Root Directory = `apps/web`**, **Framework Preset = Next.js** (leave Build/Output overrides off), enable **Include source files outside of the Root Directory**, then *Deployments → ⋯ → Redeploy* (untick "use existing build cache"). |
| Repo not listed in Vercel import | Vercel's GitHub App is not installed on `rpsj2230`, or Vercel is linked to a different GitHub account. Use *Adjust GitHub App Permissions*. |
| Vercel account linked to `rp2230career`, cannot be changed | Fallback: deploy from GitHub Actions with the Vercel CLI using a Vercel token (I will add the workflow; you add secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`). |
| Build fails: "Cannot find module '@fwos/core'" | The *Include source files outside of the Root Directory* option is off. Turn it on and redeploy. |
| `/api/health` shows `env` flags `false` | The variable is missing or was added after the build. Add it, then Redeploy. |
| `/api/health` → `"supabase": "unreachable"` | Wrong URL (must be `https://<ref>.supabase.co`) or wrong public key. |
| Login emails never arrive | Built-in Supabase mail limits. Use *Add user* with *Auto Confirm* for now. |
| Site shows a Vercel login wall | *Deployment Protection → Vercel Authentication* applies to that environment. Keep it for previews; for production our own login protects the data. |
| Supabase project "paused" | Free projects pause after one week of inactivity. Restore it in the dashboard; the daily keep-alive job (task P0.9) prevents this once enabled. |

## Security checklist

- [ ] Service-role/secret key exists only in Vercel (Sensitive) and later GitHub secrets
- [ ] No `.env` file committed (`.gitignore` blocks it)
- [ ] Public sign-ups disabled in Supabase
- [ ] Both users can log in; passwords are unique and stored in a password manager
- [ ] Rotate keys if any were ever pasted somewhere they should not be (Supabase → API Keys → regenerate, update Vercel, redeploy)
