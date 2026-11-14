# Vibeproof

University security project: a scanner for "vibe-coded" web apps (React / Next.js / Vite front ends on Supabase or Firebase), built to measure how often AI-generated apps ship with open database rules and exposed secrets.

It runs two tracks and produces a formal PDF report plus JSON data for each scan.

| Track | Input | What it checks |
|---|---|---|
| `repo` (white-box) | A local git repository | Secrets in files **and full git history**, tracked `.env` files, secret-named `NEXT_PUBLIC_`/`VITE_` variables, Supabase migrations without RLS or with `using (true)` policies, open storage policies and public buckets, `security definer` functions callable by anon, edge functions without caller checks, Firebase rules that are open or in test mode, `service_role` used outside server code, missing lockfile, optional `npm audit` |
| `web` (black-box) | A deployed URL | Security headers, secrets and `service_role` JWTs in shipped JavaScript, public source maps, exposed `/.env` and `/.git/HEAD`, a **read-only** Supabase probe (can the public anon key read each table, including tables found through the API schema?), public storage buckets, and anonymous reads of the Firebase Realtime Database and Firestore |

## Rules of engagement

- Scan only apps the team owns, or apps whose owner has given written permission. The project currently scans **our own repos only**.
- Web scans run only on domains you have **proven you own**. The scanner gives each domain a token; publish it as a file at `/.well-known/vibeproof-verification.txt` or as a DNS TXT record `vibeproof-verification=<token>`, and the scan checks it automatically. Apps on localhost need no verification. Tokens are derived from a local secret in `~/.config/vibeproof/key`. Records in the older `vscan-verification=vscan-...` format still work.
- The web track can only send `GET` requests (see `readOnlyGet` in `src/checks/web.ts`). Table probes use `limit=1`, and row values are never stored; reports list column names only.
- Secret values are redacted everywhere (reports, JSON, console). A `service_role` key found in a target is decoded to read its role and never used.
- If a real secret turns up, rotate it first, then fix the code and purge history.

## Setup

Requires Node 20 or later and git.

```bash
npm install
npm run build
```

## Dashboard

```bash
npm run dashboard
```

Then open http://localhost:4173. From the dashboard you can:

- type a repository path or a URL and press Scan; the scan type is detected automatically, and an unverified domain shows its verification token;
- browse the scan history, filter findings by severity or text, and expand each finding for evidence and the fix;
- open or download the PDF report and the JSON data, or delete a scan.

The dashboard can read local folders, so it is locked down: it listens on 127.0.0.1 only, rejects foreign `Host` headers (DNS rebinding) and cross-origin requests, and requires an `x-vibeproof` header on every request that changes something (CSRF). All finding text is rendered with `textContent`, so content from a scanned site cannot inject HTML. Use `--port` or `PORT` to change the port.

## Command line

```bash
node dist/cli.js repo ../our-app --out reports/our-app-repo.pdf
node dist/cli.js repo ../our-app --npm-audit          # also run npm audit
node dist/cli.js verify our-app.example.com          # show the ownership token, check if it is published
node dist/cli.js web https://our-app.example.com --out reports/our-app-web.pdf
node dist/cli.js web https://our-app.example.com --supabase-url https://xyz.supabase.co   # custom domain or self-hosted
node dist/cli.js report reports/our-app-web.json --out reports/our-app-web.pdf   # re-render a PDF
```

Without `--out`, reports go to `reports/<track>-<timestamp>.pdf` with a matching `.json`. The `reports/` folder is git-ignored because reports describe real weaknesses.

## Lab and tests

`lab/lab.mjs` generates a deliberately vulnerable app with known planted flaws (the ground truth), plus a local HTTP server that imitates its deployment and Supabase REST API. Fake keys are assembled at runtime so this repository contains no key-shaped strings.

```bash
npm test       # checks that both tracks find every planted flaw and nothing in the safe parts
npm run demo   # writes reports/sample-repo-report.pdf and reports/sample-web-report.pdf
```

## Evaluation

The research question is whether scanning with repository access or from the browser alone finds more. `lab/catalog.mjs` defines 12 lab apps in the style AI app builders produce: 7 with planted flaws, 2 "hard cases" with realistic flaws in forms the rules were not written for, and 3 clean controls. Each app is built as a real git repository plus a simulated deployment (`lab/deploy.mjs`) that imitates the Supabase and Firebase APIs.

```bash
npm run evaluate   # writes evaluation/results.json, evaluation/RESULTS.md, evaluation/evaluation-report.pdf
```

Current results (32 planted flaws):

| Setup | Flaws found | Found within reach | False alarms |
|---|---|---|---|
| Repository only | 20/32 (63%) | 20/23 (87%) | 1 |
| Browser only | 18/32 (56%) | 18/19 (95%) | 1 |
| Combined | 30/32 (94%) | 30/32 (94%) | 2 |

13 flaws leave evidence only in the repository (storage and database policies, privileged functions, edge functions, secrets in history) and 9 only in the deployment (tables made in the dashboard, files the host serves, headers), so neither setup alone can reach every flaw. The clean controls produce no false alarms; the two false alarms are marketplace listings that are public on purpose. The four misses within reach are the hard cases, kept as known gaps rather than fixed against the test set. Full method, breakdowns and threats to validity are in `evaluation/evaluation-report.pdf`.

## Rule catalogue

All rules, with severity, OWASP Top 10 (2021) and CWE mapping, are in `src/rules.ts`.

| ID | Finding | Default severity |
|---|---|---|
| VP-SEC-001 | Private key material exposed | critical |
| VP-SEC-002 | Live API secret key (Stripe, AWS, GitHub, OpenAI, Slack) | critical / high |
| VP-SEC-003 | Hard-coded credential | high |
| VP-ENV-001 | `.env` file committed to git | high |
| VP-ENV-002 | Secret-named variable with a public build prefix | high |
| VP-ENV-003 | No dependency lockfile | low |
| VP-DB-001 | Table without row level security | high |
| VP-DB-002 | RLS policy allows all rows | critical (anon write) / high |
| VP-DB-004 | `service_role` referenced outside server-only code | high |
| VP-DB-005 | Table readable with the public anon key (live) | high |
| VP-DB-006 | Supabase `service_role` key exposed | critical |
| VP-WEB-001..004 | Missing CSP, HSTS, clickjacking and nosniff headers | medium / low |
| VP-WEB-005 | Public source maps | medium |
| VP-WEB-006 | `/.env` or `/.git` publicly reachable | critical / high |
| VP-DB-007 | `security definer` function callable by anon through `/rest/v1/rpc` | high |
| VP-DB-008 | `security definer` function without a fixed `search_path` | medium |
| VP-DB-009 | API schema (`/rest/v1/`) readable with the anon key (live) | low |
| VP-STO-001 | Storage policy lets anyone read or write files | critical (write) / medium |
| VP-STO-002 | Public storage bucket | low |
| VP-FN-001 | Edge function uses `service_role` without checking the caller | high (critical if JWT check is off) |
| VP-FN-002 | Edge function with `verify_jwt = false` and no check of its own | medium |
| VP-FB-001 | Firebase rules allow access to everyone | critical (write) / high |
| VP-FB-002 | Firebase rules still in test mode | high |
| VP-FB-003 | Firebase data readable without signing in (live) | high |
| VP-DEP-001 | Dependencies with critical or high advisories | critical / high |

## Project layout

```
src/cli.ts            command line entry point
src/run.ts            runs one scan and writes JSON + PDF (shared by CLI and dashboard)
src/dashboard/        local dashboard server
dashboard/            dashboard UI (HTML, CSS, JS, no build step)
src/checks/repo.ts    white-box checks (files, git history, SQL migrations, npm audit)
src/checks/backend.ts storage, privileged functions, edge functions, Firebase rules
src/verify.ts         domain ownership verification (file or DNS token)
src/checks/web.ts     black-box checks (headers, bundles, source maps, Supabase and Firebase probes)
src/secrets.ts        secret patterns and JWT role decoding
src/rules.ts          rule catalogue with OWASP and CWE mapping
src/report/pdf.ts     formal PDF report
lab/                  lab apps (catalog.mjs), simulated deployment, evaluation runner, demo
evaluation/           evaluation results (JSON, Markdown, PDF)
test/                 node:test suite
```

## Roadmap

1. Run both tracks on the team's own apps and record results.
2. Close the known gaps from the evaluation's hard cases (service keys with other names, policies that trust any signed-in user, lazily loaded chunks, Firestore rules that trust any signed-in user), then re-evaluate on new held-out apps.
3. Optional gitleaks/trufflehog integration to compare detection coverage.
