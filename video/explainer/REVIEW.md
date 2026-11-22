# Review: Vibeproof explainer ("Two ways in")

## v6 (owner: does not like the whooshes, too repetitive)

- No whooshes left. The 45 camera puffs and the cursor slide are gone. The 13 scene cuts are now a warm low note from the background chord. Text lines get a soft mallet note from the current chord, never the same note twice in a row, and thinned to at least 0.5 s apart (37 left). Highlights are a glass ping only, punch-ins a soft knock only, and the join's noise riser is turned down.
- 90 sounds instead of 137. Mix -18.1 LUFS. The background chords play throughout, so there is no silence (nothing under -45 dB for 1 s); the longest gap between effects is about 5.6 s.
- Same picture as v5. Render: renders/vibeproof-explainer-v6.mp4.

## v5 (owner: "same sound effect"; no HyperFrames; make everything ourselves)

- Picture: our own renderer (tools/render/render.mjs). Chrome draws each scene's HTML; our code mounts the scenes, shows/hides clips, seeks the timelines and blends 8 subframes for motion blur on moving frames; ffmpeg only encodes. 6660 frames, matches v4 to the frame (mean difference 0.1-2.2 of 255).
- Sound: every effect and a soft background bed synthesized with numpy (tools/sound/synth.py), on the same 137 cue times. Each cue is varied: six swishes compared pairwise are 4-12% alike. Final mix -18 LUFS; no gap over 1.5 s below -50 dB.
- Known limits: very fast moves show faint stepped copies (more subframes would smooth them); slow camera drift frames are a little soft.
- Render: renders/vibeproof-explainer-v5.mp4 (renders/ is not in git). Rebuild: `python3 tools/sound/synth.py`, `node tools/render/render.mjs`, then mux with ffmpeg.

## v4 (owner feedback: parts with no sound; panels moved like they were dragged)

- Motion: every scene-to-scene move softened (exit power3.in, arrival 18 frames expo.out instead of power4 in 10-12 frames) and render-time motion blur on (`data-motion-blur="on"` on the root), so fast moves smear instead of stepping. Checked frame by frame: smooth glide, no jumps.
- Sound: 137 short effects (no music): swishes on every line and every camera move, typing and key ticks under the code and the request log, thuds on tag slams, the key and the shield, ticks on each result number, clicks on real clicks, one hit on the join, a chime on the mark. Silences over 3 s in the render: 30 -> 5 (each 3-4.5 s, plus the end hold).
- Render: renders/vibeproof-explainer-v4.mp4.

## v2 (owner feedback: "dead", no sound effects, no end-card subtitle)

- Removed the 44 original sound effects. v3: a smaller, quieter set of 26 (soft whooshes on the 13 camera swings, soft clicks on the 5 real clicks, low thuds on the 6 tag slams, one bass hit on the results join, a chime on the end mark). No music, by the owner's choice. Render: renders/vibeproof-explainer-v3.mp4.
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
