# Review: Vibeproof explainer ("Two ways in")

## v2 (owner feedback: "dead", no sound effects, no end-card subtitle)

- Removed all 44 sound effects; the film is silent until a music track is chosen.
- Removed the end-card line under "Vibeproof" (including "university project").
- Liveliness pass (SPEC.md "v2 ALIVE PASS"): code world dark, site world white, hook and blind split half dark / half light, end card dark; camera always moving and re-targeting each beat; words rise from a mask with one red marker per beat; found tags slam in; velocity-matched cuts between all scenes and between screens; safety objects enlarged.
- Kept the owner's own Studio edit: the 3D tilt on the end card.
- check: ok, no errors; remaining warnings are density advisories. Rendered renders/vibeproof-explainer-v2.mp4 (3:42, 1080p, silent).


## Creative calls

- Storyline B "Two ways in" (STORYLINES.md), chosen for the class project because it carries the research question and its answer. A ("The night before launch") and C ("Follow one key") were not built.
- No voice, as asked. Large on-screen lines carry the explanation; 44 bundled sound effects (clicks, key ticks, pops, whooshes on cuts, two bass hits) sit on visible actions.
- No music bed: no music source on this machine (HeyGen not installed, local generator not available). To add music: drop a track into assets/ and add one `<audio id="music" ...>` to index.html with `data-volume` around 0.25, or sign in to HeyGen for catalog music.
- Real screens: every dashboard image is the real app, captured by tools/capture-screens.mjs from a separate dashboard instance scanning the lab app "taskflow". One cosmetic edit: the lab repository's temporary path is shown as ~/projects/taskflow.
- Illustrative, not factual: the commit messages in the git-history drawings (code and blind scenes) and the short JavaScript excerpt in the blind scene; the lab repository has a single commit.

## What was measured, what was only looked at

- `hyperframes check`: passes, no errors. Kept warnings: `timeline_track_too_dense` per scene (each line and screenshot is its own timed clip on purpose); one info `text_occluded` in site at a mid-wipe frame.
- Looked at: the review sheets (beats, nine cut strips, phone width), and per-scene snapshots by the scene builders. All numbers on screen checked against evaluation/results.json: 24/33, 19/33, 33/33 and 11/12, 6/12, 12/12.
- Sound: placement measured (each effect's peak lands one frame after its picture); nobody listened to the mix.
- Phone width: the paper scenes read; the dashboard screens are too small to read on a phone (fine for a projector).

## Weakest shot

Safety (164-180 s): each statement's drawn object is small against a mostly empty frame. With more time: scale the objects about 1.8x and centre the statement block vertically.

## Notes for the next change

- SPEC.md is the source of truth for every scene; change it with the film.
- Recapture screens after dashboard changes: `node tools/capture-screens.mjs <scratch-dir>`.
