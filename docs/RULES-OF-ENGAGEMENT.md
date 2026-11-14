# Rules of Engagement

Vibeproof: security scanning of vibe-coded web apps. University security project.

| Item | Detail |
|---|---|
| Project | Vibeproof, a scanner for secrets, database access rules and client-side exposure in AI-built web apps |
| Team | [Names of team members] |
| Supervisor | [Supervisor name] |
| Period | [Start date] to [End date] |
| Version | 1.0, 14 November 2026 |

## 1. Purpose

These rules define what the team may scan, how, and what happens when a real weakness is found. They protect the owners of the systems involved, the university, and the team. Every scan in this project follows them; the tool enforces the technical rules where it can.

## 2. Scope

In scope:

- Repositories and deployed apps owned by a team member.
- Apps whose owner has given written permission, kept on file with the supervisor before the first scan.
- The synthetic lab apps in this repository, which run only on the local machine.

Out of scope:

- Any repository or website without the owner's permission, even if it is public or looks vulnerable.
- Accounts, data or infrastructure of third parties reached through a target (for example payment or email providers).

## 3. Permitted activities

- Repository scans: reading files and git history. No code from the target is run.
- Live scans: HTTP GET requests only, after ownership of the domain is verified. Database probes use the public key that the site already ships, request at most one row per table, and store column names only, never values.
- Running the evaluation lab on the local machine.

## 4. Prohibited activities

- Requests that change data (POST, PUT, PATCH, DELETE), login attempts, password guessing, fuzzing or load testing.
- Using any key, token or password found during a scan, for any purpose.
- Scanning a target to which section 2 does not apply.
- Publishing or sharing reports outside the team, the app owner and the supervisor.

## 5. Safeguards built into the tool

- Live scans require proof of domain ownership (a DNS TXT record or a file on the site); apps on the local machine are exempt.
- The live scanner has a single network function that can only send GET requests.
- Public repositories are downloaded without the user's stored credentials, so private repositories are never fetched by accident.
- Secret values are redacted in every report, log and export.
- Fix prompts for AI agents mark scanned text as untrusted, to stop instructions planted in a target from reaching the agent.

## 6. Data handling

- Reports are kept in each member's local reports folder, which is excluded from git.
- Reports are shared only with the app owner and the supervisor, through private channels.
- Reports about third-party apps are deleted at the end of the project; findings used in the write-up are anonymised.

## 7. When a real weakness is found

- In a team member's app: rotate any exposed secret first, then fix the code or configuration, then re-scan to confirm.
- In a third-party app scanned with permission: report it privately to the owner within 7 days, with the report and suggested fixes. No public mention until the owner has fixed it or 90 days have passed, whichever comes first.
- Found incidentally outside scope (for example while reading a public repository): stop, do not use or verify it, and tell the supervisor, who decides how to notify the owner.

## 8. Sign-off

| Role | Name | Signature | Date |
|---|---|---|---|
| Supervisor | | | |
| Team member | | | |
| Team member | | | |
| Team member | | | |
