# SPEC: Vibeproof, "Two ways in" (storyline B)

GOAL: a classmate who has never heard of Vibeproof can say at the end: "it scans an app two ways, through its code and through its live site, each finds things the other cannot, so you use both."

OUTPUT: HyperFrames, 1920 x 1080, 30 fps. No voice. Text on screen carries the explanation. Sound: bundled sound effects only, no music bed (no music source on this machine; noted in delivery).

TIME: 222 s x 30 = 6660 frames. Ten scenes, hard cuts between scenes (each cut gets one whoosh).

## LOOK

Two worlds, one type system, one accent rule.

1. PAPER world (scenes hook, stack, code, site, blind, safety, results, end): a technical drawing.
   - ground #FFFFFF; a hairline grid of 1 px lines in #0A0A0A at 5% opacity every 48 px, full bleed, static.
   - ink #0A0A0A for every word and structural line (2 px strokes, 10 px corner radius on boxes).
   - muted ink #6B6B6B for secondary words only.
   - accent FLAW red #E5342F: only on the flaw being discussed (one focus per frame), as a 3 px underline, a ring, or a filled tag with white text.
   - accent FOUND black tag: a filled #0A0A0A tag with white text "found" when Vibeproof reports a flaw.
   - code: JetBrains Mono 28 px, #0A0A0A on #F2F2F0 panels with 24 px padding, line numbers in #9A9A9A.
2. PRODUCT world (scenes repo-demo, web-demo): the real Vibeproof dashboard, true black #000 as in the product.
   - screenshots from assets/screens/*.png (3840 x 2160, the real app at 2x) shown full frame (1920 x 1080), never smaller than 80% of the frame width.
   - camera: punch-ins with scale 1.0 -> 1.6..2.2 and translate to the area that matters (transform on a wrapper, `transform-origin: 0 0`).
   - highlight: a 3 px #FFFFFF rounded rectangle (radius 10) drawn around the element, no dimming of the rest.
   - cursor: a drawn white arrow cursor 34 px with a 2 px black outline, moving on power2.inOut 18-24 frames, click = scale 0.85 for 4 frames.
   - captions: one line at a time in a black band 120 px tall at the bottom (y 960-1080), white Inter 700 44 px, left aligned at x 96.

TYPE (both worlds): Inter only (bundled 400, 700, 900); code JetBrains Mono (bundled).
- display: Inter 900, 84 px, letter-spacing -0.02em, line-height 1.05, max 2 lines, max width 1500 px.
- line: Inter 700, 44 px, letter-spacing -0.01em.
- label: Inter 700, 28 px (minimum size of any readable text).
- left margin 96 px, top safe 108 px, bottom safe 108 px (title-safe 80% box: x 192-1728, y 108-972 for key text in paper scenes; captions band excepted in product scenes).

## OBJECTS (must read without a label)

- THE APP "taskflow": a browser window drawn in ink: 2 px rounded frame 1100 x 640, a top bar with three 12 px circles and an address field reading "taskflow.app" (lab app), inside a to-do list with 4 rows (checkbox + text: "Ship landing page", "Fix login bug", "Write tests", "Launch") in Inter 400 30 px.
- THE CODE: a file tree panel (folders as 2 px outline icons) listing the real taskflow files:
  `supabase/migrations/20260101_init.sql`, `src/lib/supabase.ts`, `src/App.tsx`, `src/main.tsx`, `.env.example`, `package.json`, `package-lock.json`, `README.md`.
- THE DATABASE: a cylinder drawn in ink (2 px stroke) labelled "Supabase", with a table grid inside named "todos".
- THE ANON KEY: a key-shaped tag (rounded rect + circle hole) with text "anon key", travelling from the database to the browser.
- GIT HISTORY: a vertical stack of 5 commit dots joined by a 2 px line, each with a short message in 28 px.

Real code to show (from the lab app, verbatim):

```sql
create table public.todos (id bigint generated always as identity primary key, user_id uuid, title text, done boolean default false);
```
(the line that is missing: `alter table public.todos enable row level security;`)

```ts
export const supabaseAdmin = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
```

Real requests the website scan makes (read-only):
`GET /` , `GET /assets/index.js` , `GET /rest/v1/todos?select=*&limit=1` (answer: HTTP 200, one row; columns id, owner, secret_note; values not stored).

## MOTION

- enter: power3.out, 18 frames. Text appears by a left-to-right wipe (clip-path inset 0 100% 0 0 -> 0 0 0 0), never fade-and-slide-up.
- move: power2.inOut, 24 frames.
- exit inside a scene: power2.in, 12 frames, by wipe or by the object being covered by the next one.
- camera (product world punch-ins): sine.inOut, 45-75 frames.
- counting numbers: 30 frames, power1.out, integers only.
- stagger between related parts: 6 frames. One hero move per shot; secondary moves 50-70% of its distance, starting 4-6 frames later.
- A read line holds 0.5 s + 0.3 s per word before it changes. Something new every 2-4 s.

## SHOTS (scene id, file, start-end s, duration)

1. `hook` compositions/hook.html 0-12 (12 s) PAPER
   - 0.0: THE APP already on screen at 85% width, centred, a to-do list (frame 0 is never empty).
   - 0.4: display line "This app was built by an AI." (wipe in, top-left at x 96 y 108). 3.0: it changes to "It works. But is it safe?"
   - 5.4: hero move: the app splits down the middle; the left half slides 140 px left and turns into THE CODE file tree, the right half slides 140 px right and keeps the browser (power2.inOut 24 f). Labels "Its code" (left) and "Its live site" (right), label size, under each half.
   - 8.0: display line "Where do you look for the leak?" (the word "leak" in FLAW red), held to the end.
   - sound: whoosh-short at 5.4 (the split).
2. `stack` compositions/stack.html 12-30 (18 s) PAPER, one diagram that grows.
   - 0.0: the browser (left, x 200) and THE DATABASE (right, x 1300), joined by a 2 px line.
   - 1.0: line "Apps like this talk to their database directly".
   - 4.5: THE ANON KEY travels along the line from database to browser; line "Every visitor's browser gets this key".
   - 8.5: a shield drawn on the database edge labelled "access rules"; line "Only the access rules protect the data".
   - 12.5: the shield breaks (two halves part 20 px, turn FLAW red); line "One wrong rule, and the data is open". Held to the end.
   - sound: pop at 4.5 (key lands), error at 12.5 (shield breaks), 0.35 volume.
3. `code` compositions/code.html 30-56 (26 s) PAPER, the left half from the hook, now full frame.
   - 0.0: THE CODE file tree on the left (x 96-640), a code panel on the right (x 700-1824). Line "With the code, Vibeproof reads every file".
   - 3.5: GIT HISTORY appears beside the tree; a scan bar (2 px ink line) sweeps down the tree and the commits. Line "and every past commit, even deleted lines".
   - 8.0: the migration file opens in the panel, the create table line types in (typing sfx). 11.0: a ghost line with the missing `alter table ... enable row level security;` appears in FLAW red, struck through. Line "Here, the todos table has no access rules". Tag "found" pops beside it at 13.0.
   - 15.0: the panel switches to src/lib/supabase.ts; the supabaseAdmin line types in; VITE_SUPABASE_SERVICE_ROLE_KEY underlined in FLAW red at 18.0. Line "and the admin key is sent to every browser". Tag "found" at 20.0.
   - 22.5: line "Both found by reading, no code is run". Held.
   - sound: typing at 8.0 and 15.0, pop at 13.0 and 20.0.
4. `site` compositions/site.html 56-82 (26 s) PAPER, the right half from the hook, now full frame.
   - 0.0: THE APP browser on the left (x 96-1000), a request log panel on the right (x 1060-1824), empty. Line "Without the code, it sees what every visitor sees".
   - 4.0: request rows type into the log one by one: `GET /` 200, `GET /assets/index.js` 200 (key tick per row). Line "the page and the JavaScript it ships".
   - 8.5: inside the JS, a token string is highlighted, decodes to `"role": "service_role"` in FLAW red. Line "The admin key is inside, for anyone to copy". Tag "found" at 11.5.
   - 14.0: row `GET /rest/v1/todos?limit=1` types in, answer `200 · 1 row`; a single table row slides out of THE DATABASE with its values replaced by grey bars and the label "values not stored". Line "It asks the database for one row, read-only". 19.0: line "It answered. Anyone can read this table." Tag "found".
   - 23.0: line "Every request only reads, nothing is changed". Held.
   - sound: key-press per log row, pop on each "found".
5. `blind` compositions/blind.html 82-100 (18 s) PAPER. The two halves side by side again (code left, site right), each 820 px wide.
   - 0.0: display line "Each side has blind spots".
   - 3.0: on the site half, a table "bookings" appears in the database with the note "made in the dashboard"; the code half shows the migrations folder with no such file and a FLAW red "not here". Line "A table made in the dashboard leaves no trace in the code".
   - 9.5: on the code half, a commit dot glows FLAW red "key deleted, still in history"; the site half shows the JS with no such key and "not here". Line "A key deleted from the code still lives in git history".
   - 15.0: line "So Vibeproof scans both". Held.
   - sound: pop at 3.0 and 9.5.
6. `repodemo` compositions/repodemo.html 100-132 (32 s) PRODUCT. Real screens.
   - 0.0 welcome.png full frame; caption "Vibeproof runs on your computer, in the browser".
   - 3.5 typed.png: cursor moves to the input; caption "Paste a repo link, a folder or a website".
   - 7.5 cursor clicks Scan (click sfx); cut to scanning.png; punch-in 1.0 -> 1.6 on the progress card; caption "It shows each stage as it runs".
   - 12.5 report-repo.png; caption "Every finding, grouped by severity"; highlight the 4 findings list.
   - 18.0 finding-repo.png; punch-in on the open finding; caption "Why it matters, the evidence, how to fix it".
   - 24.0 prompt.png; punch-in on the prompt preview; caption "A prompt to paste into your coding agent"; cursor clicks "Copy fix prompt" (click sfx) at 28.0 and a white toast "Prompt copied" slides in bottom-right.
7. `webdemo` compositions/webdemo.html 132-164 (32 s) PRODUCT.
   - 0.0 verify.png; punch-in 1.0 -> 1.8 on the verify panel (left sidebar); caption "Live scans need proof you own the site".
   - 6.0 caption "Publish a token in your DNS, or as a file"; highlight the File and DNS TXT rows.
   - 11.0 report-web.png; caption "Then it scans the live site, read-only"; highlight the critical finding.
   - 17.5 finding-web.png; punch-in on the open finding; caption "The todos table answered the public key".
   - 24.0 pdf-web-1.png on the PAPER ground (a sheet at 70% height, drop shadow 0 18px 40px rgba(0,0,0,0.18)), then pdf-web-2.png slides over it at 27.0; caption "Every scan ends in a PDF report".
8. `safety` compositions/safety.html 164-180 (16 s) PAPER.
   - 0.0 display line "Built to be safe to run".
   - 2.5 / 6.0 / 9.5 / 13.0: four statements, one at a time, each replacing the last in the same place (never a list), each with its own drawn object: a lock + "Only sites you prove you own"; an arrow labelled GET + "Only read requests, nothing is changed"; a key with a blurred middle "sk_l...Cd" + "Secrets are hidden in every report"; a table row of grey bars + "Row values are never stored".
   - sound: pop at each statement.
9. `results` compositions/results.html 180-210 (30 s) PAPER, the research answer.
   - 0.0 line "We tested it on 12 lab apps with 33 planted flaws".
   - 4.0 three horizontal bars build one at a time, each counting up: "Code only" 24/33, "Site only" 19/33, "Both" 33/33 (the Both bar ink black, the others #6B6B6B). Bars 1200 px long at 33/33. Numbers Inter 900 84 px.
   - 14.0 line "Each side found flaws the other could not".
   - 18.0 a second, smaller set for "6 new apps, 12 flaws": 11, 6, 12 of 12. Line "On 6 new apps, both together found all 12".
   - 25.0 the two halves motif from the hook closes into one shape. Held.
   - sound: pop as each number lands, riser timed so its peak lands at 25.0, impact-bass-1 at 25.0.
10. `end` compositions/end.html 210-222 (12 s) PAPER.
   - 0.0 display "Scan the code. Then check the live site." (2 lines).
   - 5.0 the mark: the shield-check logo of the dashboard drawn in ink (stroke draws on over 24 f), then "Vibeproof" Inter 900 96 px wipes in beside it; under it "Security scanner for vibe-coded apps · university project" (line size, muted). Held from 7.0 to the end.
   - sound: impact-bass-2 peaking at 5.6, at 0.4 volume.

## BANNED

Defaults from the spec guide, plus for this film:
- a dark void with small floating UI (product screens always fill the frame);
- glow, particles, gradients, glass;
- everything centred (text is left aligned at x 96 unless noted);
- fading and sliding everything up (use wipes, typing, counting, the object moving);
- three cards in a row, bullet lists, KPI grids;
- a logo docked in a corner; the brand appears once, on the end card;
- inventing numbers or claims: only the facts in this spec.

## QA (frames to check)

- 0.5 s: frame 0 shows the app, not an empty frame.
- 6.5 s: the split, two readable labels.
- 41 s and 50 s: code panel readable, red underline on the right token.
- 66 s and 72 s: the request log readable, the decoded role visible.
- 90 s: both blind spots readable.
- 108 s, 125 s, 140 s, 156 s: real screens sharp, caption band readable, highlight on the right element.
- 172 s: one safety statement, its object.
- 192 s and 205 s: bars with correct numbers 24, 19, 33 and 11, 6, 12.
- 218 s: end card complete.

## v2 ALIVE PASS (owner feedback: "the video is so dead", no sound effects, no end-card subtitle)

Applies to every scene on top of v1. Same text, same timings, same facts. No sound at all for now.

1. TWO WORLDS that carry the story.
   - CODE world (dark): ground #0B0B0C, grid lines #FFFFFF at 6% every 48 px, text #F2F2F2, muted #8A8A8A, code panels #17171A with #F2F2F2 code and #5C5C5C line numbers, flaw red #FF4D4F, "found" tags white with black text.
   - SITE world (light): the v1 PAPER world.
   - hook: starts in SITE; at the split (5.4 s) the left half's ground turns to CODE (dark) behind the file tree, the right half stays white: the frame becomes half dark, half light.
   - stack: SITE. code: CODE. site: SITE. blind: left half CODE, right half SITE (hard vertical seam at x 960). repodemo, webdemo: product black (unchanged). safety: SITE. results: SITE. end: CODE (white mark and type on the dark ground).
2. CAMERA always moving. Wrap all scene content (not the grid ground) in `#<id>-cam`, transform-origin at the active area.
   - A slow push across the whole scene: scale 1.00 -> 1.06, sine.inOut, full scene duration.
   - At every beat the camera re-targets towards the element that just appeared: translate 40-120 px, power2.inOut, 20 frames (attention leads the frame).
   - Product scenes: between punch-ins a slow drift 1.00 -> 1.03; keep the existing punch-ins.
3. KINETIC TYPE.
   - Every line enters word by word from a mask: the line box has overflow hidden; each word starts at translateY 110% and lands at 0, power4.out, 14 frames, 2-frame stagger. A leaving line exits upward through the mask, power2.in, 8 frames, 1-frame stagger. This replaces the v1 wipes for text (wipes stay for drawn lines and bars).
   - Display lines (hook, blind opener, safety title, end claim) grow from 84 px to 100 px.
   - One key word per beat gets a marker: a FLAW red bar (height 0.9em, behind the word, white text on top) that grows scaleX 0 -> 1 from the left in 10 frames, power3.out. At most 2 per scene. Product captions: the marker is white with black text.
4. OBJECTS react.
   - "found" tags and badges slam in: scale 1.45 -> 1, power4.out, 9 frames, with the parent panel recoiling 6 px and settling (power2.out, 10 frames).
   - Things that appear overshoot: scale 0.9 -> 1, back.out(1.7), 16 frames; things that travel use power3.out and arrive with a 4-frame settle.
   - Counting numbers in results: on landing, each number scales 1.18 -> 1 in 8 frames.
5. VELOCITY-MATCHED CUTS on every scene boundary, always the same direction (forward = to the left).
   - Outgoing: in the scene's last 10 frames the camera wrapper accelerates to translateX -420 px, power4.in.
   - Incoming: in the scene's first 12 frames the camera wrapper travels from translateX +420 px to 0, power4.out.
   - hook has no incoming move (frame 0 stays the app); end has no outgoing move.
   - Product scenes apply the same moves to their screenshot camera.
6. NO DEAD AIR: never more than 2 s without a visible change of at least 20 px or a new element. Fill long holds with the camera re-target or a secondary reaction, never with breathing loops.

BANNED additions: plain left-to-right wipe on text; a line that appears all at once; any hold longer than 2 s with nothing moving; sound effects.
