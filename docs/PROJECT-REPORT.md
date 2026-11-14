# Vibeproof: Scanning Vibe-Coded Web Apps with and without Repository Access

University security project report. Draft for review by the team and the supervisor.

| Item | Detail |
|---|---|
| Team | [TEAM: names of team members] |
| Supervisor | [TEAM: supervisor name] |
| Course | [TEAM: course name and code] |
| Repository | github.com/loueylahwel/vibeproof (private) |
| Version | 0.9 draft, 14 November 2026 |

## Abstract

AI app builders and coding agents let people ship full web applications without writing most of the code themselves ("vibe coding"). These apps typically pair a JavaScript front end with a backend-as-a-service such as Supabase or Firebase, where security depends on configuration that the author may never have looked at: row level security policies, storage rules, privileged database functions, and which keys reach the browser. We built Vibeproof, a scanner that checks such apps in two ways: by reading the source repository (white-box) and by inspecting the deployed site with read-only requests (black-box). We then asked which approach finds more. On a lab of 12 apps with 33 planted flaws, repository scanning found 24, browser-only scanning found 19, and the two combined found all 33. On a held-out set of 6 apps written before the final rule changes, the figures were 11, 6 and 12 out of 12. Neither approach alone can see every flaw: 14 flaws in the main lab left evidence only in the repository and 9 only in the deployment. We conclude that repository access is the stronger single setup, but a read-only browser scan of the live deployment is needed to see what is actually exposed.

## 1. Introduction

Vibe-coded apps are often built by people who describe what they want and accept the generated code. The resulting apps tend to share a structure: a React, Next.js or Vite front end, a hosted database exposed directly to the browser through an API, and a few serverless functions. In this model the browser holds a public API key, and the only thing standing between that key and the data is the database's access rules.

The mistakes this invites are well known to security practitioners but easy for a non-specialist to make: a table without row level security, a policy whose condition is simply true, a privileged key placed in a variable that the build tool copies into the browser bundle, test-mode database rules that were never replaced, a secret committed and later deleted but still present in git history.

This project had two goals:

- Build a tool that detects these mistakes and explains how to fix them, safely enough to run against real apps.
- Answer a research question: is it more effective to scan with access to the repository, or from the browser only, without access?

## 2. Background

### Backend-as-a-service security model

- Supabase gives every project a public "anon" key that ships to the browser by design. Access control is enforced by Postgres row level security (RLS): if a table has no RLS, or a policy allows every row, anyone holding the anon key can read or change the data.
- Supabase also issues a service_role key (and, in the newer format, sb_secret_ keys) that bypasses RLS entirely. It must never reach the browser.
- Firebase web apps ship their project configuration to the browser by design. Firestore, Realtime Database and Storage are protected only by security rules; the default "test mode" rules allow everything until a date.

### Why this matters for the research question

Some of these settings live in files in the repository (SQL migrations, rules files, function code). Others exist only in the deployed system: tables created by clicking in a dashboard, environment variables set at the host, files the host serves by mistake. A repository scan and a browser scan therefore see different parts of the same app.

## 3. Research question

Does scanning a vibe-coded app with access to its repository find more security flaws than scanning its deployed site from the browser only, and what does combining them add?

We measure, for each setup, how many planted flaws it finds, how many flaws it can reach at all (the flaw leaves evidence where the setup looks), and how many false alarms it raises.

## 4. The tool

### Architecture

Vibeproof is a TypeScript command-line tool with a local web dashboard. Both share one scan engine with two tracks and one rule catalogue of 28 rules, each mapped to the OWASP Top 10 (2021) and a CWE entry.

| Component | Role |
|---|---|
| Repository track | Reads files and full git history: secrets, environment files, public build variables, SQL migrations, storage policies, privileged functions, edge functions, Firebase rules, lockfile, optional npm audit |
| Browser track | Reads the page, its headers and every same-origin script including lazily loaded chunks; probes the Supabase and Firebase APIs with the public key the site already ships |
| Reports | Formal black-and-white PDF and JSON for every scan, with redacted evidence |
| Dashboard | Local web interface: scan by repository link, folder or URL, live progress, history, filters, fix prompts |

### Repository track

- Secrets: patterns for private keys and provider keys (cloud, payment, source hosting, AI APIs), Supabase keys decoded to read their role, and credential assignments, applied to every text file and every added line in git history.
- Database rules: static parsing of SQL migrations for tables without RLS, policies that allow all rows, and policies that let any signed-in user change every row.
- Storage and functions: anonymous storage policies, public buckets, security definer functions callable by anonymous users or without a fixed search_path, and edge functions that use the service_role key without checking the caller.
- Firebase: rules that allow access unconditionally, test-mode rules, and rules where being signed in is the only condition.

### Browser track

- Response headers, secrets and privileged keys in shipped JavaScript, public source maps, exposed /.env and /.git.
- Supabase: tables named in the code or listed in the API schema are each requested once with the anon key, limited to one row; only column names are kept. Bucket metadata reveals public buckets.
- Firebase: the Realtime Database root and Firestore collections named in the code are requested without credentials.

### Safety by design

The tool is meant to be run against real apps, so its safeguards are part of the design rather than guidelines:

- Live scans run only on domains whose ownership is proven with a token published as a DNS TXT record or a file on the site; the token is derived from a local secret. Apps on the local machine are exempt.
- The browser track has a single network function that can only send GET requests.
- Public repositories are cloned without the user's stored git credentials, so a private repository is refused rather than fetched.
- Secret values are redacted everywhere; row values from live probes are never stored.
- The dashboard listens on the local machine only and rejects cross-site and DNS-rebinding requests.

### Fix prompts for AI agents

Because the developers of these apps usually work through coding agents, every finding comes with a prompt that can be pasted into an agent: the issue, concrete steps for that rule, and constraints (change only what is needed, never print or commit secrets, list what the developer must do outside the code). Scanned text can contain instructions planted by an attacker, so it is placed in a block the agent is told to treat as untrusted data, cleaned of characters that could escape that block, and shortened.

## 5. Evaluation method

### Lab

Each lab app is a small project in the style that AI builders produce, built as a real git repository, together with a simulated deployment: a local web server that serves the site and imitates the Supabase REST and storage APIs and the Firebase Realtime Database and Firestore REST APIs. Every planted flaw lists, for each setup, the rule that should report it; a setup without an entry cannot see that flaw by design.

| Set | Apps | With flaws | Clean controls | Planted flaws |
|---|---|---|---|---|
| Development | 12 | 9 | 3 | 33 |
| Held-out | 6 | 4 | 2 | 12 |

### Procedure

- The development set was used while building the scanner. Two of its apps are "hard cases": realistic flaws in forms the first rules did not cover. Their misses exposed four gaps.
- The held-out set contains new variants of those four gap classes plus other flaws and clean controls. It was written and scored with the unchanged scanner, and that baseline was committed to git before any fix. Both sets were then scored again after the fixes.
- A finding counts for a flaw when its rule matches and, where given, a distinguishing word appears in its location or evidence. A finding that matches no planted flaw is a false alarm.

### Metrics

- Found: planted flaws reported by at least one finding of the setup.
- Found within reach: the same, over flaws that leave evidence where the setup looks.
- Precision: the share of findings that match a planted flaw.

## 6. Results

### Detection by setup

| Set | Setup | Found | Within reach | False alarms | Precision |
|---|---|---|---|---|---|
| Development | Repository only | 24/33 (73%) | 24/24 | 1 | 96% |
| Development | Browser only | 19/33 (58%) | 19/19 | 1 | 96% |
| Development | Combined | 33/33 (100%) | 33/33 | 2 | 96% |
| Held-out | Repository only | 11/12 (92%) | 11/11 | 2 | 86% |
| Held-out | Browser only | 6/12 (50%) | 6/6 | 0 | 100% |
| Held-out | Combined | 12/12 (100%) | 12/12 | 2 | 91% |

### Where flaws leave evidence (development set)

| Evidence in | Planted | Repository only | Browser only | Combined |
|---|---|---|---|---|
| Both | 10 | 10 | 10 | 10 |
| Repository only | 14 | 14 | 0 | 14 |
| Deployment only | 9 | 0 | 9 | 9 |

### Before and after closing the gaps

| Set | Setup | Found before | Found after |
|---|---|---|---|
| Development | Repository only | 20/33 | 24/33 |
| Development | Browser only | 18/33 | 19/33 |
| Development | Combined | 30/33 | 33/33 |
| Held-out | Repository only | 6/12 | 11/12 |
| Held-out | Browser only | 3/12 | 6/12 |
| Held-out | Combined | 8/12 | 12/12 |

The four gaps were: privileged keys under other variable names and in the newer key format, policies that trust any signed-in user, secrets in lazily loaded JavaScript, and Firebase rules where being signed in is the only condition. Before the fixes, every flaw that the combined setup still missed (3 in the development set, 4 in the held-out set) belonged to one class: rules that trust any signed-in user. The other gaps were each covered by the other track: a misnamed service key was caught in the browser bundle, and a key in a lazily loaded chunk was caught in the repository.

### False alarms

- The five clean control apps raised no false alarms, apart from the map key in one held-out repository described below.
- Development set: a marketplace whose listings are public on purpose was reported by both tracks. The scanner cannot know intent.
- Held-out set: a browser map key, public by design, was reported twice because its variable name contains API_KEY. It was left unfixed rather than special-cased after seeing the held-out set.

### Pilot on team-owned apps

[TEAM: run Vibeproof on the team's own repositories and deployed apps, following the rules of engagement, and summarise here: number of apps, findings by category, anything surprising. Anonymise app names.]

## 7. Discussion

Repository access was the stronger single setup on both sets. It sees configuration that never reaches the browser (database and storage policies, privileged functions, edge functions) and secrets that survive only in git history, and it gives precise evidence: a file and a line.

Browser-only scanning found fewer flaws, but it is the only way to see what is actually deployed. Nine flaws in the development set existed only in the deployment: two tables created in the Supabase dashboard with no migration (one of them found only through the API schema), the exposed API schema itself, an environment file and git metadata served by the host, public source maps, and missing security headers on three sites. A repository scan cannot report what is not in the repository.

Combining the two reached every planted flaw on both sets, and before the final fixes the combination already masked most single-track gaps. The practical recommendation is therefore to scan the repository first, for coverage and precise evidence, and then confirm the live deployment with a read-only browser scan.

The remaining false alarms point to a limit of static, rule-based scanning: some exposures are intended. A public product catalogue and a browser map key look the same to a rule as a leak. The fix prompts handle this by asking the agent to leave intended public data alone and say so.

## 8. Ethics and safety

The project operates under written rules of engagement (docs/RULES-OF-ENGAGEMENT.md), signed by the supervisor before any scan of a real app. They restrict scanning to the team's own apps and apps with written permission, forbid any request that changes data or uses a discovered secret, and define how a real weakness is reported. The tool enforces the technical parts of these rules itself, as described in section 4. All evaluation apps are synthetic and run on the local machine; no third-party system was scanned.

## 9. Limitations and threats to validity

- The team wrote both the scanner and the lab, so planted flaws resemble what the rules look for. Real apps will contain flaws in forms that are missed more often.
- The held-out set was written after the gaps were known, by people who knew them. It uses different names, key formats and code shapes, but it is not independent in the way apps from an outside source would be.
- One labelling error was found in the development set while closing the gaps and corrected before the baseline was recorded.
- Where a flaw leaves evidence is a property of each scenario; other scenarios would change the headline numbers.
- The simulated deployment imitates Supabase and Firebase; real services can differ in status codes and in what the anon key may read.
- The sample is small. The results show which setup can see which kind of flaw, not how common each flaw is.
- The browser track cannot call database functions or list storage files, because both need requests that are not GET; only the repository track covers them.

## 10. Future work

- An independent test set: real vibe-coded apps from outside the team, scanned with their owners' permission.
- A comparison with established secret scanners such as gitleaks and trufflehog.
- Understanding intent: letting a project declare which data is meant to be public, to remove the remaining false alarms.
- Authenticated browser scans, with a test account supplied by the owner, to check what an ordinary signed-in user can read.

## 11. Conclusion

Vibeproof detects the configuration mistakes that are typical of AI-built apps and explains how to fix them, including prompts for the coding agents these developers use. On our lab, repository access found more flaws than browser-only scanning, but neither found everything: the repository misses what exists only in the deployment, and the browser misses what never reaches it. Scanning both ways found every planted flaw on the development and held-out sets.

## References

- OWASP Top 10 (2021). owasp.org/Top10
- MITRE Common Weakness Enumeration. cwe.mitre.org
- Supabase documentation: Row Level Security. supabase.com/docs/guides/database/postgres/row-level-security
- Firebase documentation: Security Rules. firebase.google.com/docs/rules
- gitleaks, secret scanner. github.com/gitleaks/gitleaks
- [TEAM: add academic and industry sources on vibe coding and on security of AI-generated code, as required by the course]

## Appendix A. Reproducing the results

- npm install, then npm run build.
- npm test runs 37 tests, including the full evaluation on both lab sets.
- npm run evaluate writes evaluation/results.json, evaluation/RESULTS.md and evaluation/evaluation-report.pdf.
- npm run docs renders this report and the rules of engagement to PDF.
