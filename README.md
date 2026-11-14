# vibe-security-scanner

University security project: a scanner for "vibe-coded" web apps (React / Next.js / Vite front ends on Supabase), built to measure how often AI-generated apps ship with open database rules and exposed secrets.

It runs two tracks and produces a formal PDF report plus JSON data for each scan.

| Track | Input | What it checks |
|---|---|---|
| `repo` (white-box) | A local git repository | Secrets in files **and full git history**, tracked `.env` files, secret-named `NEXT_PUBLIC_`/`VITE_` variables, Supabase migrations without RLS or with `using (true)` policies, `service_role` used outside server code, missing lockfile, optional `npm audit` |
| `web` (black-box) | A deployed URL | Security headers, secrets and `service_role` JWTs in shipped JavaScript, public source maps, exposed `/.env` and `/.git/HEAD`, and a **read-only** Supabase probe: can the public anon key read each table? |

## Rules of engagement

- Scan only apps the team owns, or apps whose owner has given written permission. The project currently scans **our own repos only**.
- The `web` command refuses to run without `--authorized`.
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

- run a repository scan (path on this computer) or a live web app scan (URL, with the permission checkbox);
- browse the scan history, filter findings by severity or text, and expand each finding for evidence and the fix;
- open or download the PDF report and the JSON data, or delete a scan.

The dashboard can read local folders, so it is locked down: it listens on 127.0.0.1 only, rejects foreign `Host` headers (DNS rebinding) and cross-origin requests, and requires an `x-vscan` header on every request that changes something (CSRF). All finding text is rendered with `textContent`, so content from a scanned site cannot inject HTML. Use `--port` or `PORT` to change the port.

## Command line

```bash
node dist/cli.js repo ../our-app --out reports/our-app-repo.pdf
node dist/cli.js repo ../our-app --npm-audit          # also run npm audit
node dist/cli.js web https://our-app.example.com --authorized --out reports/our-app-web.pdf
node dist/cli.js web https://our-app.example.com --authorized --supabase-url https://xyz.supabase.co   # custom domain or self-hosted
node dist/cli.js report reports/our-app-web.json --out reports/our-app-web.pdf   # re-render a PDF
```

Without `--out`, reports go to `reports/<track>-<timestamp>.pdf` with a matching `.json`. The `reports/` folder is git-ignored because reports describe real weaknesses.

## Lab and tests

`lab/lab.mjs` generates a deliberately vulnerable app with known planted flaws (the ground truth), plus a local HTTP server that imitates its deployment and Supabase REST API. Fake keys are assembled at runtime so this repository contains no key-shaped strings.

```bash
npm test       # checks that both tracks find every planted flaw and nothing in the safe parts
npm run demo   # writes reports/sample-repo-report.pdf and reports/sample-web-report.pdf
```

## Rule catalogue

All rules, with severity, OWASP Top 10 (2021) and CWE mapping, are in `src/rules.ts`.

| ID | Finding | Default severity |
|---|---|---|
| VSC-SEC-001 | Private key material exposed | critical |
| VSC-SEC-002 | Live API secret key (Stripe, AWS, GitHub, OpenAI, Slack) | critical / high |
| VSC-SEC-003 | Hard-coded credential | high |
| VSC-ENV-001 | `.env` file committed to git | high |
| VSC-ENV-002 | Secret-named variable with a public build prefix | high |
| VSC-ENV-003 | No dependency lockfile | low |
| VSC-DB-001 | Table without row level security | high |
| VSC-DB-002 | RLS policy allows all rows | critical (anon write) / high |
| VSC-DB-004 | `service_role` referenced outside server-only code | high |
| VSC-DB-005 | Table readable with the public anon key (live) | high |
| VSC-DB-006 | Supabase `service_role` key exposed | critical |
| VSC-WEB-001..004 | Missing CSP, HSTS, clickjacking and nosniff headers | medium / low |
| VSC-WEB-005 | Public source maps | medium |
| VSC-WEB-006 | `/.env` or `/.git` publicly reachable | critical / high |
| VSC-DEP-001 | Dependencies with critical or high advisories | critical / high |

## Project layout

```
src/cli.ts            command line entry point
src/run.ts            runs one scan and writes JSON + PDF (shared by CLI and dashboard)
src/dashboard/        local dashboard server
dashboard/            dashboard UI (HTML, CSS, JS, no build step)
src/checks/repo.ts    white-box checks (files, git history, SQL migrations, npm audit)
src/checks/web.ts     black-box checks (headers, bundles, source maps, Supabase probe)
src/secrets.ts        secret patterns and JWT role decoding
src/rules.ts          rule catalogue with OWASP and CWE mapping
src/report/pdf.ts     formal PDF report
lab/                  vulnerable lab app, mock deployment, demo script
test/                 node:test suite
```

## Roadmap

1. Run both tracks on the team's own apps and record results.
2. Firebase: parse `firestore.rules` / `database.rules.json` for `allow read, write: if true`.
3. Optional gitleaks/trufflehog integration to compare detection coverage.
4. Larger lab (5 to 10 apps, plus clean controls) and precision/recall per rule for the write-up: repo-only vs web-only vs combined.
