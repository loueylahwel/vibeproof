# Vibeproof detection evaluation

Generated 2026-11-14 by vibeproof 0.3.0. Regenerate with `npm run evaluate`; the full report is `evaluation-report.pdf`.

The **development set** (`lab/catalog.mjs`) was used while building the scanner. The **held-out set** (`lab/holdout.mjs`) was written and scored before the scanner was changed to close the gaps the development set exposed, so it shows whether those fixes generalise.

## Before and after closing the gaps

| Set | Setup | Found before | Found after | False alarms before | False alarms after |
|---|---|---|---|---|---|
| Development | Repository only | 20/33 (61%) | 24/33 (73%) | 1 | 1 |
| Development | Browser only | 18/33 (55%) | 19/33 (58%) | 1 | 1 |
| Development | Combined | 30/33 (91%) | 33/33 (100%) | 2 | 2 |
| Held-out | Repository only | 6/12 (50%) | 11/12 (92%) | 2 | 2 |
| Held-out | Browser only | 3/12 (25%) | 6/12 (50%) | 0 | 0 |
| Held-out | Combined | 8/12 (67%) | 12/12 (100%) | 2 | 2 |

## Development set

12 apps (9 with planted flaws, 3 clean controls), 33 planted flaws.

| Setup | Flaws found | Found within reach | Findings | False alarms | Precision | False alarms on clean apps |
|---|---|---|---|---|---|---|
| Repository only | 24/33 (73%) | 24/24 (100%) | 28 | 1 | 96% | 0 |
| Browser only | 19/33 (58%) | 19/19 (100%) | 27 | 1 | 96% | 0 |
| Combined | 33/33 (100%) | 33/33 (100%) | 55 | 2 | 96% | 0 |

| Evidence in | Planted | Repository only | Browser only | Combined |
|---|---|---|---|---|
| Both | 10 | 10 | 10 | 10 |
| Deployment only | 9 | 0 | 9 | 9 |
| Repository only | 14 | 14 | 0 | 14 |

| App | Stack | Planted | Repo | Web | Combined | False alarms (repo / web) |
|---|---|---|---|---|---|---|
| taskflow | Vite + Supabase | 3 | 2 | 3 | 3 | 0 / 0 |
| chatpal | Next.js + OpenAI | 3 | 2 | 2 | 3 | 0 / 0 |
| swapmeet | React + Supabase storage and RPC | 4 | 4 | 1 | 4 | 1 / 1 |
| bookit | React + Supabase (tables made in the dashboard) | 5 | 1 | 4 | 5 | 0 / 0 |
| liftlog | React + Firebase | 4 | 4 | 2 | 4 | 0 / 0 |
| folio-cms | Static site with a deploy script | 5 | 2 | 4 | 5 | 0 / 0 |
| teampulse | React + Supabase edge functions | 4 | 4 | 1 | 4 | 0 / 0 |
| shopcart | Next.js + Supabase | 3 | 3 | 2 | 3 | 0 / 0 |
| studyhub | React + Firebase | 2 | 2 | 0 | 2 | 0 / 0 |
| notely (clean) | React + Supabase, done right | 0 | 0 | 0 | 0 | 0 / 0 |
| trailmap (clean) | React + Firebase, done right | 0 | 0 | 0 | 0 | 0 / 0 |
| launchpage (clean) | Static marketing site | 0 | 0 | 0 | 0 | 0 / 0 |

**Missed within reach:** none.

**False alarms:** 
- swapmeet (repo): VP-DB-002 Row level security policy allows all rows. Policy "public listings" on table "listings": for select, to anon, condition is true. _Note: Listings are public on purpose; the scanner cannot know intent, so both tracks report them._
- swapmeet (web): VP-DB-005 Table readable with the public anon key. Anon key returned a row (probe used limit=1). Columns exposed: id, owner, secret_note. Row values were not stored. _Note: Listings are public on purpose; the scanner cannot know intent, so both tracks report them._

## Held-out set

6 apps (4 with planted flaws, 2 clean controls), 12 planted flaws.

| Setup | Flaws found | Found within reach | Findings | False alarms | Precision | False alarms on clean apps |
|---|---|---|---|---|---|---|
| Repository only | 11/12 (92%) | 11/11 (100%) | 14 | 2 | 86% | 2 |
| Browser only | 6/12 (50%) | 6/6 (100%) | 8 | 0 | 100% | 0 |
| Combined | 12/12 (100%) | 12/12 (100%) | 22 | 2 | 91% | 2 |

| Evidence in | Planted | Repository only | Browser only | Combined |
|---|---|---|---|---|
| Both | 5 | 5 | 5 | 5 |
| Repository only | 6 | 6 | 0 | 6 |
| Deployment only | 1 | 0 | 1 | 1 |

| App | Stack | Planted | Repo | Web | Combined | False alarms (repo / web) |
|---|---|---|---|---|---|---|
| recipebox | Vite + Supabase (new key format) | 3 | 3 | 2 | 3 | 0 / 0 |
| eventhub | Next.js + Supabase + OpenAI | 3 | 2 | 3 | 3 | 0 / 0 |
| petpals | React + Firebase | 2 | 2 | 0 | 2 | 0 / 0 |
| invoicely | Vite + Supabase | 4 | 4 | 1 | 4 | 0 / 0 |
| gardenlog (clean) | Vite + Supabase, done right | 0 | 0 | 0 | 0 | 2 / 0 |
| quizzy (clean) | React + Firebase, done right | 0 | 0 | 0 | 0 | 0 / 0 |

**Missed within reach:** none.

**False alarms:** 
- gardenlog (repo, clean control): VP-ENV-002 Secret-named variable has a public build prefix. Variable name: VITE_MAPS_API_KEY
- gardenlog (repo, clean control): VP-ENV-002 Secret-named variable has a public build prefix. Variable name: VITE_MAPS_API_KEY
