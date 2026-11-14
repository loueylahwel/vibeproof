# Vibeproof detection evaluation

Generated 2026-11-14 by vibeproof 0.3.0 on 12 lab apps (9 with planted flaws, 3 clean controls), 32 planted flaws. Regenerate with `npm run evaluate`; the full report is `evaluation-report.pdf`.

## Summary

| Setup | Flaws found | Found within reach | Findings | False alarms | Precision | False alarms on clean apps |
|---|---|---|---|---|---|---|
| Repository only | 20/32 (63%) | 20/23 (87%) | 23 | 1 | 96% | 0 |
| Browser only | 18/32 (56%) | 18/19 (95%) | 26 | 1 | 96% | 0 |
| Combined | 30/32 (94%) | 30/32 (94%) | 49 | 2 | 96% | 0 |

## By where the flaw leaves evidence

| Visible in | Planted | Repository only | Browser only | Combined |
|---|---|---|---|---|
| Both | 10 | 9 | 9 | 10 |
| Deployment only | 9 | 0 | 9 | 9 |
| Repository only | 13 | 11 | 0 | 11 |

## By category

| Category | Planted | Repository only | Browser only | Combined |
|---|---|---|---|---|
| database | 8 | 4 | 5 | 7 |
| secrets | 8 | 7 | 4 | 8 |
| exposure | 8 | 2 | 6 | 8 |
| storage | 2 | 2 | 1 | 2 |
| functions | 2 | 2 | 0 | 2 |
| firebase | 4 | 3 | 2 | 3 |

## By app

| App | Stack | Planted | Repo | Web | Combined | False alarms (repo / web) |
|---|---|---|---|---|---|---|
| taskflow | Vite + Supabase | 3 | 2 | 3 | 3 | 0 / 0 |
| chatpal | Next.js + OpenAI | 3 | 2 | 2 | 3 | 0 / 0 |
| swapmeet | React + Supabase storage and RPC | 4 | 4 | 1 | 4 | 1 / 1 |
| bookit | React + Supabase (tables made in the dashboard) | 5 | 1 | 4 | 5 | 0 / 0 |
| liftlog | React + Firebase | 3 | 3 | 2 | 3 | 0 / 0 |
| folio-cms | Static site with a deploy script | 5 | 2 | 4 | 5 | 0 / 0 |
| teampulse | React + Supabase edge functions | 4 | 4 | 1 | 4 | 0 / 0 |
| shopcart | Next.js + Supabase | 3 | 1 | 1 | 2 | 0 / 0 |
| studyhub | React + Firebase | 2 | 1 | 0 | 1 | 0 / 0 |
| notely (clean) | React + Supabase, done right | 0 | 0 | 0 | 0 | 0 / 0 |
| trailmap (clean) | React + Firebase, done right | 0 | 0 | 0 | 0 | 0 / 0 |
| launchpage (clean) | Static marketing site | 0 | 0 | 0 | 0 | 0 / 0 |

## Missed within reach

- Repository only: shopcart / service_role key in NEXT_PUBLIC_SUPABASE_SERVICE_KEY used by a client component
- Repository only: shopcart / orders policy lets any signed-in user change every order
- Repository only: studyhub / Firestore rules let any signed-in user read and write every document
- Browser only: shopcart / Stripe key in a lazily loaded admin chunk
- Combined: shopcart / orders policy lets any signed-in user change every order
- Combined: studyhub / Firestore rules let any signed-in user read and write every document

## False alarms

- swapmeet (repo): VP-DB-002 Row level security policy allows all rows. Policy "public listings" on table "listings": for select, to anon, condition is true. _Note: Listings are public on purpose; the scanner cannot know intent, so both tracks report them._
- swapmeet (web): VP-DB-005 Table readable with the public anon key. Anon key returned a row (probe used limit=1). Columns exposed: id, owner, secret_note. Row values were not stored. _Note: Listings are public on purpose; the scanner cannot know intent, so both tracks report them._
