# Vibeproof walkthrough video: three storylines

Facts used in every storyline come from the project: the dashboard as built, the lab app "taskflow" and its real flaws (service_role key shipped through a VITE_ variable, todos table without row level security), and the evaluation numbers (development set: repository 24/33, browser 19/33, combined 33/33; held-out set: 11, 6 and 12 of 12).

Assumptions for all three: 3 to 4 minutes, 1920x1080 at 30 fps, real dashboard screens captured from localhost, narrated with the free on-device Kokoro voice (a HeyGen voice is the paid option), a music bed from the free local generator if it installs, otherwise delivered with effects only and a note on how to add music (HeyGen catalog music is the paid option).

## Recommended: A. "The night before launch"

Pick it because a stranger follows one person with one real problem, and every feature appears as a step they actually need.

- Device and form: a moment in someone's day, carried as an object-to-object chain. Maya, a solo builder, made a to-do app with an AI builder and launches tomorrow; one leaked key travels through the whole film, from her .env, into the shipped JavaScript, onto a Vibeproof finding, into a fix prompt, and out of the app. The viewer feels the small dread of "is my app actually safe?" turn into a clean re-scan.
- First two seconds: a laptop screen at night, a launch checklist with every box ticked except one, "Is it secure?", the cursor hovering over it.
- Beats: hook (the unticked box) → tension (the app looks fine; the key sits in the bundle, invisible) → reveal (Vibeproof, pasting the repo link) → proof (live progress, findings grouped by severity, opening the critical one, the evidence) → the website scan (domain ownership token, read-only probes, the todos table answering with one row) → fix (copy fix prompt, paste into the coding agent, the agent's change) → payoff (re-scan: no critical findings, the PDF report) → claim (scan the code and the live site) → end card.
- Look: three worlds sharing one palette: Maya's desk in warm lamp light around the laptop, the dashboard on true black with its white accent and severity dots, the black-and-white PDF on white paper; Inter throughout.
- Sound: a calm late-night piano bed around 80 bpm that tightens under the critical finding and opens at the clean re-scan; clicks on real clicks, a soft tick when findings land, one riser into the clean result.

## B. "Two ways in"

The film for the university presentation: it carries the research question and its answer.

- Device and form: the object is the explanation, as split screen to one. The same app is shown twice at once, its repository on the left and its live website on the right; the scanner works on both halves in parallel, flaws light up on the side that can see them, and the halves merge into one view when the combined result lands.
- First two seconds: one app splits down the middle into its code and its website, with the question "Where do you look for the leak?".
- Beats: hook (the split) → what the repository shows (files, git history, SQL policies) → what the website shows (bundles, headers, live database probes) → flaws only one side can see (a table made in the dashboard, a key deleted from the code but alive in history) → the dashboard running both scans → the evaluation numbers counting up (24, 19, then 33 of 33; held-out 12 of 12) → the halves merge → claim → end card.
- Look: a white technical-drawing world for the two halves, the dashboard on black when the halves merge, numbers set large in Inter.
- Sound: a steady 100 bpm pulse; the left and right halves each get their own soft tone colour; one impact as the halves merge.

## Bold: C. "Follow one key"

The one you would not pick first: no tour of screens, one secret's journey.

- Device and form: one object across layers, as an endless zoom. The camera starts on the live website, dives into its JavaScript, into one string, into the decoded key ("role": "service_role"), through it into the database rows it unlocks, and pulls back out each time to show Vibeproof catching the key at that layer.
- First two seconds: an ordinary sign-up page; the camera is already pushing in towards the page source.
- Beats: hook (the page) → dive into the bundle → the key string → decode → the open database → pull back: Vibeproof found it in under a second → the same dive for the open table → the fix prompt closes each layer in reverse → the zoom ends back on the page, now safe → claim → end card.
- Look: one continuous descent through layers: page, code on near-black, the decoded token as large type, rows as a physical grid; the dashboard frames each pull-back.
- Sound: a low continuous drone that drops in pitch with each layer down, a click when Vibeproof flags each layer, and a release when the zoom returns to the surface.
