# Phase 1 — Cost and Dependency Register

Target: **₹0 recurring**. Last reviewed: 25 Oct 2026. "Verified" = checked against the provider's published page this session; "To verify" = must be confirmed before Phase 2 relies on it.

| # | Dependency | Purpose | Free allowance | Expected use | Status | Cost trigger | Fallback |
|---|---|---|---|---|---|---|---|
| 1 | **Vercel Hobby** | Hosts the Next.js UI/API | Cron limited to once per day with ±59 min precision; up to 100 cron jobs ([docs](https://vercel.com/docs/cron-jobs/usage-and-pricing)) | UI only; no heavy cron | Verified (cron). Hobby is for non-commercial use; confirm current terms for personal finance use | Pro plan if limits breached | Self-host or Cloudflare Pages |
| 2 | **Supabase Free** | Postgres, Auth, Storage | 500 MB DB, 1 GB file storage, 5 GB bandwidth; **project pauses after 1 week of inactivity** ([pricing](https://supabase.com/pricing)) | DB < 50 MB (NAV stored only for held schemes) | Verified | Pro $25/mo; a paused project goes dark | Daily GitHub Action keep-alive; weekly encrypted export |
| 3 | **GitHub (private repo) + Actions** | Source control; scheduler for NAV/FX fetch, parsing, digest, keep-alive, backups | Free monthly Actions minutes for private repos | ~5–10 min/day | **To verify** current allowance and scheduled-run delays | Minutes exhausted | Vercel daily cron for the minimum jobs |
| 4 | **AMFI NAV file** | Daily NAV for held schemes | Free public file `NAVAll.txt`; history downloadable in windows of ≤ 90 days ([AMFI](https://www.amfiindia.com/net-asset-value/nav-download)) | One download/day | Verified (page); endpoint stability to verify | Endpoint change | Kuvera/CAS closing NAV; manual entry |
| 5 | **FX source (SGD→INR)** | Convert S$ balances | Candidate: free ECB-based API | 1 call/day | **To verify** (terms, SGD/INR coverage) | Rate-limit | Last known rate flagged stale; manual rate |
| 6 | **Gmail API (read-only)** on your mailbox | Read forwarded bank emails with a label | Free personal use | < 100 messages/month | **To verify** OAuth behaviour (refresh-token lifetime for apps in testing mode) | Token expiry | Manual upload; IMAP app-password route |
| 7 | **Resend** (outbound email) | Daily digest and alerts | **100 emails/day, 3,000/month**; inbound mail also counts ([docs](https://resend.com/docs/knowledge-base/account-quotas-and-limits)) | 2 recipients, ≤ 3/day | Verified | Quota breach | Send via Gmail SMTP with app password |
| 8 | **CAS parser** (e.g. open-source `casparser`) | Parse CAMS/KFintech CAS PDFs | Open source | Monthly | **To verify** licence, maintenance, current CAS formats | Parser breaks on format change | Kuvera transaction export (CSV) import; manual ledger |
| 9 | **Kuvera export** | Alternative MF transaction/gains source | Free with your account | Ad hoc | **To verify** available report formats | — | CAS |
| 10 | **Chart library** (e.g. Recharts / ECharts) | Interactive charts | Open source (MIT/Apache) | Client | To confirm at selection | — | — |
| 11 | **WhatsApp** | Daily summary sharing | No safe free official personal automation | Manual tap | Design decision | Paid Business API | `wa.me` prefilled share link |
| 12 | **SMS** | Optional alerts | No genuinely free option identified | — | Off by default | — | Email + WhatsApp share |
| 13 | **Domain** | App URL | Free `*.vercel.app` | — | Decided by you | Custom domain | — |

## Notes

- **No paid service is introduced.** If any item above flips to paid, the app keeps working in degraded mode (manual updates and share links).
- Storage plan for the 500 MB database: roughly 20 held schemes × ~5,000 daily NAVs is well under 20 MB; transactions and observations for a household are tiny. Source PDFs go to the 1 GB bucket, with a retention rule.
- The free Supabase plan has no automated backups, so a scheduled encrypted export is part of Phase 2 acceptance.
- Secrets live only in Vercel and GitHub encrypted secrets; nothing sensitive in the repo. `.gitignore` already blocks spreadsheets, CSVs, PDFs and `.env` files.
