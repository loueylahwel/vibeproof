# Vibeproof app walkthrough (screen recording)

A 1:40 recording of the real dashboard scanning the lab app "taskflow": folder scan,
report, severity filter, a finding, the fix prompt, the PDF, the ownership check for
someone else's site, the live-site scan and the history. No voice: short step captions,
a drawn mouse pointer, click and key sounds, and a soft synthesized music bed.

Rebuild (about 3 minutes; needs dist/ built, /usr/bin/google-chrome, ffmpeg, pdftoppm):

    node video/walkthrough/tools/record.mjs <scratch>          # drives and records the app
    cd video/walkthrough
    node tools/assemble.mjs <scratch> renders/walkthrough-video.mp4
    python3 tools/sound.py <scratch> <scratch>/sound.wav
    ffmpeg -i renders/walkthrough-video.mp4 -i <scratch>/sound.wav -map 0:v -map 1:a -c:v copy \
      -af "volume=6.5dB,alimiter=limit=0.84:level=false" -c:a aac -b:a 256k -shortest \
      -movflags +faststart renders/vibeproof-walkthrough.mp4

What is staged, not real:
- The scratch home folder is shown as "~" (the server expands "~/projects/taskflow"
  itself; only the long scratch path is shortened on screen and in the PDF).
- The lab's stand-in Supabase is local, not on *.supabase.co, so the site scan gets its
  address added the way the CLI's --supabase-url flag does.
- The PDF is shown over the page as page images (headless Chrome has no PDF viewer).
- Pointer, click rings and captions are drawn by the recorder.
