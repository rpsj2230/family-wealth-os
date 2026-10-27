# Runbook — Fund statements from Gmail

The job **Read fund statements from Gmail** (`.github/workflows/statements.yml`, code in `workers/src/statements.ts`, rules in `packages/ingest/src/statement-mail.ts` and `statement-scan.ts`) finds the consolidated account statements that CAMS, KFintech, NSDL, CDSL and MF Central e-mail to you, anywhere in your Gmail, and imports them. It uses fixed rules only: **no AI key is read, no AI service is called and no `ai_usage` row is written.** The cost is nil (GitHub Actions minutes within the free allowance; a start that finds nothing to do takes under a minute).

It is the second way statements reach the app. The first, the `FWOS/Inbox` label (`inbox.yml`), still works and shares the same importer and the same record of messages already handled, so a message is never imported twice by the two jobs.

## What you need

Nothing beyond the bank-email setup (docs/NEEDS-FROM-YOU.md A8): GitHub secrets `SUPABASE_SERVICE_ROLE_KEY`, `SMTP_USER` (the Gmail address) and `SMTP_APP_PASSWORD` (a Gmail app password), IMAP switched on in Gmail. **No new secret is added.** The app signs in with an app password over IMAP, not with Google sign-in.

Then, once:

1. Save each person's PAN in Settings > People (the importer opens statements with it).
2. Check **Settings > Money rules > Gmail statements**: the switch is on, and the senders list holds the domains your statements really come from (see "Senders" below).
3. Run the job once by hand to fill in the past: GitHub > Actions > Read fund statements from Gmail > Run workflow. The first scan looks back 400 days (a Setting).

## How a scan works

1. **Plan.** From Settings: the allowed senders, the addresses you forward from, the look-back (400 days on the first scan, or after a gap longer than the regular window; 35 days otherwise).
2. **Search on the server.** The job opens Gmail's *All Mail* folder (found by its role, so a different language does not matter) **read only** and sends one search per sender: *From contains `camsonline.com` since `<date>`*, and one per address of yours that forwards statements. The rest of the mailbox is never listed or downloaded.
3. **Judge the envelope.** For the messages the server returned, it fetches only the envelope, the size, the structure and Gmail's `Authentication-Results` header. A message is a candidate only when: the **address** in From (never the display name) is an allowed domain or address, or is one of yours (a forward); Gmail did not mark it `dmarc=fail`; it has a PDF; it is within the size limit (15 MB, a Setting). The subject is not required to match anything.
4. **Skip what was handled.** A message whose Message-ID is already recorded in the Inbox log is skipped. Candidates are sorted **oldest first** and at most 40 (a Setting) are read per scan; the rest wait for the next one.
5. **Download and import.** Only candidates are downloaded. Each PDF is opened with, in turn: no password, the person's saved PAN (capitals, then small letters), then that person's extra statement passwords. The importer then checks that the PAN on the statement is that person's and that the parser recognises a fund statement, compares it with what is on file and writes only what is new or changed (`importCasPdf`, the same function the label job and the upload use). A forward from your own address is accepted only when the original sender written inside it is an allowed one.
6. **Record.** Each message gets a row in the Inbox log with an outcome and a plain sentence ("Fund statement from CAMS: 3 funds, 12 transactions added", "Could not open: none of the saved passwords fits…"), and the scan gets a row in `statement_scans` (when, how many found, imported, problems, the list shown on the card).

Messages that could not be opened are tried again only when someone presses **Scan now** or runs the job by hand (maybe after saving a password); a message that errored is always tried again.

## Sold funds

A complete statement lists every fund held with the registrar, so a fund missing from it can be judged sold. That is only done when the statement is complete: **a statement that lists balances only, or that mentions demat holdings (a combined CAMS + KFintech mailback can carry a demat section), never marks a fund as sold.** This is the same rule as for uploaded statements. A fund judged sold from a complete statement is recorded in the import's change list, where it can be reviewed.

## What is read, and what is never done

Read: the envelope of messages from allowed senders (and of your own forwards); the whole message only for those that pass the checks above; the PDF text of a statement.

Kept: the sentence per message, the masked mailbox address (`a***@g***.com`), a capped text excerpt of the message (6000 characters, account numbers cut to four digits and PAN-shaped codes hidden, as the label job does), the imported funds and transactions.

Never: the app does not send, delete, label, move, copy or flag a message, and does not mark one as read. This is enforced three ways: the mailbox is opened with IMAP `EXAMINE` (read only; the server refuses changes), messages are fetched with `BODY.PEEK`, and the code can only call search, fetch and list (a test reads the worker source and fails on any call that changes a mailbox). Passwords and PANs are never written to a log, the Inbox record, `cas_imports`, a task or a page; statement passwords live in a table the app cannot read (only the service role).

## Senders

Defaults, checked on 27 Oct 2026 (Settings holds the live list; domains also cover their sub-domains):

| Who | Sender seen | Domain in the list | Evidence |
|---|---|---|---|
| CAMS | `donotreply@camsonline.com`, display name "CAMS Mailback Server", subject "Consolidated Account Statement - CAMS Mailback Request" | `camsonline.com` | A real statement e-mail in the household's mailbox, 27 Oct 2026. The body is headed "CONSOLIDATED ACCOUNT STATEMENT - CAMS + KFintech" and the banner says mailback statements now include mutual fund holdings in demat mode. |
| KFintech | `samfS@kfintech.com` | `kfintech.com`, `karvy.com` (the former name) | Sender table in https://casparser.in/blog/import-nri-portfolio-without-otp/ (third party). |
| NSDL e-CAS | `NSDL-CAS@nsdl.co.in` | `nsdl.co.in`, `nsdl.com` | Same table; NSDL's own FAQ https://investor.nsdl.com/portal/en/kb/articles/faqs-on-cas-26-10-2023 uses `nsdl.co.in` addresses and the e-CAS portal https://nsdlcas.nsdl.com uses `nsdl.com`. |
| CDSL e-CAS | `eCAS@cdslstatement.com` | `cdslstatement.com`, `cdslindia.com` | Same table. CDSL's own FAQ https://www.cdslindia.com/CAS/FAQ.html does not name the sender. |
| MF Central | not found | `mfcentral.com` | Listed because the service is run by CAMS and KFintech; no sender address was found in public sources. |

Only the CAMS line is confirmed first-hand. If a statement from NSDL or CDSL does not arrive in the scan, open one in Gmail, look at the real sender address (Show original) and add its domain in Settings.

## Scan now, and why it is not instant

The app (on Vercel) has no credential that can start a GitHub job, and adding one would be a new secret with write access to the repository, so it was not added. **Scan now** therefore leaves a request (`statement_scans`, `requested_at`); the job checks for it every time it starts, which is every 6 hours (`40 0,6,12,18 * * *` UTC). A scheduled start without a request does the work only if the last scan finished more than the Settings gap (20 hours) ago, so there is one scan a day. To run at once: GitHub > Actions > *Read fund statements from Gmail* > Run workflow (a manual start always scans, and also retries statements that could not be opened). If you wish the button to start the job directly, a fine-grained token with only *Actions: write* on this repository, stored as an environment variable of the Vercel project, would allow a call to the workflow-dispatch API; that is a decision for the owner.

## Asking for a statement (guided, not automated)

Feasibility, inspected 27 Oct 2026 with plain requests (honest user agent, no scripting of any form):

| Registrar | Page | Findings |
|---|---|---|
| KFintech | https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement | A mailback form: Summary or Detailed; current FY, previous FY or a specific period; include zero-balance folios; e-mail (required); PAN (optional); a password of 8 to 12 characters with a capital, a small letter, a number and a special character. **Image CAPTCHA** (`/investor/Captcha/GetCaptchaImage`, plus a reCAPTCHA script). No login. No published API and no terms for automation were found. A PAN as the password is not accepted by the form's rule. |
| CAMS | https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement | The form is drawn by script (the plain page has none), with its own CAPTCHA script (`camsCAPTCHA.js`). Driving it would need a hidden browser. No published API. |
| MF Central | https://www.mfcentral.com | Needs sign-up and sign-in with a one-time code; a Detailed statement for a period of up to 365 days a time (so a full history needs several requests). Terms of use are linked; no public API. |

A security check exists so that a program cannot pass it, and the owner's rule is to neither bypass nor script around one. **So nothing is automated:** the card lists exactly what to choose, opens the official page (official domains only, new tab, `rel="noopener noreferrer"`), and the person presses **I have asked** to note it in `statement_requests`. The scan marks the request *arrived* when a statement for that person is imported (the importer does it, so an upload counts too); after the Settings number of days (2) without arrival the card says so and the job leaves one task. Nothing is sent to the registrar by the app, and no PAN or address is put in a link.

Considered and rejected: third-party services that generate a statement for you through an API (for example casparser.in's `/v4/generate`) take your PAN and e-mail address to a company that is not the registrar; the household's rule is official sources only and the PAN stays private.

## Passwords

The PAN, saved write-only in Settings, is the expected password: choose it on the request form where the page allows. Some services (Value Research, for one) choose a random password and e-mail it separately; the PDF is then not protected by the PAN. For that, **Statement passwords** on the card saves an extra password per person, write-only (table `statement_passwords`: no read policy, no grants, no audit trigger; added and removed through `add_statement_password` and `clear_statement_passwords`; only the count is visible through `statement_password_counts`). The app never reads a password out of an e-mail; the person types it.

## Troubleshooting

| Sign | Likely cause and fix |
|---|---|
| "Last scan" never appears | The job has not run. Run it by hand (Actions). The Actions log says "waiting for GitHub secrets" if `SMTP_USER`, `SMTP_APP_PASSWORD` or the service-role key is missing. |
| The scan stopped: Invalid credentials | The Gmail app password was revoked or IMAP is switched off (Gmail > Settings > Forwarding and POP/IMAP). |
| "Could not open: none of the saved passwords fits" | The PDF is protected by a password other than the saved PAN. Ask for the statement again with the PAN as the password, or save its password under Statement passwords and press Scan now. A PAN that is not saved for that person gives the same message. |
| "The statement opened without a password, but its PAN does not match anyone saved" | Save the PAN of the person it belongs to (Settings > People). |
| "Not read: larger than the … MB limit" | Raise the limit in Settings, or upload that statement by hand. |
| "Not read: Gmail could not confirm the sender" | The message failed Gmail's own sender check (`dmarc=fail`); it may be forged. |
| A statement is in Gmail but not listed | Its sender address is not in the list (add the domain), it has no PDF attached (a link only), or it is older than the look-back. Press Scan now after raising the look-back, or use the "Search your inbox" link on the card to see what the senders list matches. |
| A forwarded statement is ignored | Forward it as a normal forward (with the PDF attached, not "as attachment"), from an address listed under Settings > Bank e-mail forwarding or a household login. The original sender must be an allowed domain. |
| "Nothing changed: 3 funds already up to date" | Normal: the statement held nothing new. |

## Privacy

Statement PDFs are downloaded to the Actions runner, read in memory, and not stored; what is kept is the imported funds and transactions, the sentence per message and a short text excerpt as for the label job. The mailbox address is stored only in masked form. The scan reads only mail from allowed senders and your own forwards.
