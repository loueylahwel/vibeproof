// Our own renderer for the explainer (no HyperFrames code).
//
//   node tools/render/render.mjs [--workers 4] [--from N] [--to N] [--keep]
//                                [--out renders/vibeproof-explainer-own-video.mp4]
//
// Timing: frame n shows film time n / 30. The scenes in tools/cues.json play
// back to back; frame n belongs to the scene whose [start, start + duration)
// holds n / 30, at local time (n - start * 30) / 30.
//
// Each worker owns one Chrome page and one pixels.py process. It loads a scene
// shell once (scene-page.mjs) and then only seeks it (runtime.js): clip
// visibility for t, then the scene's paused GSAP timeline seeked to t with
// callbacks firing, then a screenshot.
//
// Motion blur: every frame is captured at t and probed at t + 1/60. If the
// two differ (something moves fast), or t lies in a known fast window, the
// frame is re-shot as 8 subframes spread evenly over a 180-degree shutter
// (1/60 s centred on t, kept inside the scene) and averaged in linear light.
// Static frames keep the single capture.
//
// Frames go to PNG in the scratch folder; once a scene's frames are all done,
// ffmpeg encodes them into a segment (H.264, CRF 16, yuv420p, BT.709) and the
// PNGs are deleted. The segments are joined without re-encoding at the end.
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, loadScene, W, H } from './scene-page.mjs';
import { CHROME, CHROME_ARGS, SCRATCH, CACHE, FPS } from './config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? '/home/bl9/.npm/_npx/2a702a27d5483266/node_modules/puppeteer-core');

// ---------- options
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i < 0 ? def : argv[i + 1];
};
const flag = (name) => argv.includes('--' + name);
const WORKERS = parseInt(opt('workers', '4'), 10);
const OUT = path.resolve(PROJECT, opt('out', 'renders/vibeproof-explainer-own-video.mp4'));
const KEEP = flag('keep'); // keep PNGs, skip encoding (for inspection)
const FORCE_SHARP = flag('no-blur');
const DEBUG = flag('debug');
const SUBFRAMES = parseInt(opt('subframes', '8'), 10);
const SHUTTER = 0.5 / FPS; // 180 degrees
// motion test on the t vs t + 1/60 probe (1/4-size grey copies)
const MOVE_FRAC = parseFloat(opt('move-frac', '0.0004')); // share of pixels moved > 24 levels
const MOVE_MAD = parseFloat(opt('move-mad', '0.25')); // or mean difference over the frame

const cues = JSON.parse(readFileSync(path.join(PROJECT, 'tools/cues.json'), 'utf8'));
const scenes = cues.scenes.map((s) => ({ ...s, f0: Math.round(s.start * FPS), nf: Math.round(s.duration * FPS) }));
const TOTAL = Math.round(cues.duration * FPS);
const FROM = parseInt(opt('from', '0'), 10);
const TO = parseInt(opt('to', String(TOTAL)), 10); // exclusive
const FULL = FROM === 0 && TO === TOTAL;

// known fast windows (film seconds): scene edges and the big punch-ins
const KNOWN = [];
for (const s of scenes) {
  KNOWN.push([s.start, s.start + 0.6], [s.start + s.duration - 0.4, s.start + s.duration]);
}
for (const c of [112.5, 124, 143, 156]) KNOWN.push([c - 0.3, c + 0.7]);
const inKnown = (T) => KNOWN.some(([a, b]) => T >= a - 1e-9 && T < b - 1e-9);

const RUN = path.join(SCRATCH, 'run');
const FRAMES = path.join(RUN, 'frames');
const SUB = path.join(RUN, 'sub');
const SEGS = path.join(RUN, 'segments');
for (const d of [FRAMES, SUB, SEGS]) mkdirSync(d, { recursive: true });
const framePath = (n) => path.join(FRAMES, `f${String(n).padStart(5, '0')}.png`);

// ---------- work list: chunks of frames that never cross a scene boundary
const CHUNK = 45;
const chunks = [];
for (const s of scenes) {
  const segFile = path.join(SEGS, `${String(s.f0).padStart(5, '0')}-${s.id}.mp4`);
  s.segFile = segFile;
  s.remaining = 0;
  for (let a = Math.max(s.f0, FROM); a < Math.min(s.f0 + s.nf, TO); a += CHUNK) {
    const b = Math.min(a + CHUNK, s.f0 + s.nf, TO);
    if (FULL && existsSync(segFile)) break; // resume: scene already encoded
    chunks.push({ scene: s, a, b });
    s.remaining += b - a;
  }
}

// ---------- pixels.py client
function startPixels() {
  const proc = spawn('python3', ['-I', path.join(HERE, 'pixels.py')], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  let buf = '';
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const res = JSON.parse(line);
      const w = waiting.shift();
      if (res.error) w.reject(new Error(res.error));
      else w.resolve(res);
    }
  });
  const call = (req) =>
    new Promise((resolve, reject) => {
      waiting.push({ resolve, reject });
      proc.stdin.write(JSON.stringify(req) + '\n');
    });
  return { call, close: () => proc.stdin.end() };
}

// ---------- encoding queue (one ffmpeg at a time, runs beside the capture)
const segQueue = [];
let segBusy = false;
function encodeScene(s) {
  segQueue.push(s);
  pumpEncode();
}
let encodeDone;
const allEncoded = new Promise((r) => (encodeDone = r));
let scenesToEncode = FULL && !KEEP ? scenes.filter((s) => !existsSync(s.segFile)).length : 0;
if (scenesToEncode === 0) encodeDone();
function pumpEncode() {
  if (segBusy || segQueue.length === 0) return;
  segBusy = true;
  const s = segQueue.shift();
  const tmp = s.segFile + '.tmp.mp4';
  const args = [
    '-v', 'error', '-y',
    '-framerate', String(FPS), '-start_number', String(s.f0), '-i', path.join(FRAMES, 'f%05d.png'),
    '-frames:v', String(s.nf),
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-r', String(FPS), tmp,
  ];
  const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  ff.on('exit', (code) => {
    if (code !== 0) {
      console.error(`ffmpeg failed on ${s.id} (${code})`);
      process.exit(1);
    }
    execFileSync('mv', [tmp, s.segFile]);
    for (let n = s.f0; n < s.f0 + s.nf; n++) rmSync(framePath(n), { force: true });
    log(`encoded ${s.id} -> ${path.basename(s.segFile)}, frames deleted`);
    segBusy = false;
    if (--scenesToEncode === 0) encodeDone();
    pumpEncode();
  });
}

// ---------- capture
const t0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s] ${m}`);
const stats = { frames: 0, blurred: 0, probed: 0, known: 0 };
const todo = chunks.reduce((n, c) => n + c.b - c.a, 0);

async function capture(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  writeFileSync(file, Buffer.from(data, 'base64'));
}
async function seekTo(page, t) {
  await page.evaluate((tt) => window.__render.seek(tt), t);
}

// one browser per worker: its single page is the foreground page, so nothing
// in it is throttled or parked the way background tabs are
const launch = () =>
  puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: CHROME_ARGS,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    protocolTimeout: 180000,
  });

async function worker(wi, origin) {
  const browser = await launch();
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => log(`w${wi} pageerror: ${e.message}`));
  const cdp = await page.createCDPSession();
  const px = startPixels();
  let loaded = null;
  for (;;) {
    // prefer a chunk of the scene already loaded on this page
    let ci = chunks.findIndex((c) => c.scene.id === loaded);
    if (ci < 0) ci = 0;
    if (chunks.length === 0) break;
    const { scene: s, a, b } = chunks.splice(ci, 1)[0];
    if (loaded !== s.id) {
      const info = await loadScene(page, origin, s.id);
      if (info.broken.length || info.missingFonts.length) throw new Error(`${s.id}: ${JSON.stringify(info)}`);
      if (Math.abs(info.duration - s.duration) > 1e-6) log(`warn: ${s.id} timeline is ${info.duration}s, cue says ${s.duration}s`);
      loaded = s.id;
    }
    const DUR = s.duration;
    const clampT = (t) => Math.min(Math.max(t, 0), DUR - 1e-4);
    for (let n = a; n < b; n++) {
      const t = (n - s.f0) / FPS;
      const out = framePath(n);
      let moving = false;
      if (!FORCE_SHARP && inKnown(n / FPS)) {
        moving = true;
        stats.known++;
      } else {
        await seekTo(page, t);
        await capture(cdp, out);
        if (!FORCE_SHARP) {
          const tp = t + 1 / 60 < DUR ? t + 1 / 60 : t - 1 / 60;
          const probe = path.join(SUB, `w${wi}-probe.png`);
          await seekTo(page, tp);
          await capture(cdp, probe);
          const d = await px.call({ op: 'diff', a: out, b: probe });
          moving = d.frac > MOVE_FRAC || d.mad > MOVE_MAD;
          if (DEBUG) log(`n${n} t${(n / FPS).toFixed(3)} mad ${d.mad.toFixed(3)} frac ${d.frac.toFixed(5)} ${moving ? 'BLUR' : ''}`);
          stats.probed++;
        }
      }
      if (moving) {
        // shutter window [lo, lo + SHUTTER] centred on t, slid to stay inside the scene
        let lo = t - SHUTTER / 2;
        lo = Math.min(Math.max(lo, 0), DUR - 1e-4 - SHUTTER);
        const inputs = [];
        for (let k = 0; k < SUBFRAMES; k++) {
          const ts = clampT(lo + ((k + 0.5) / SUBFRAMES) * SHUTTER);
          const f = path.join(SUB, `w${wi}-s${k}.png`);
          await seekTo(page, ts);
          await capture(cdp, f);
          inputs.push(f);
        }
        await px.call({ op: 'blend', out, inputs, remove: true });
        stats.blurred++;
      }
      stats.frames++;
      if (stats.frames % 150 === 0) {
        const el = (Date.now() - t0) / 1000;
        log(`${stats.frames}/${todo} frames, ${stats.blurred} blurred, ${(stats.frames / el).toFixed(2)} fps, eta ${((todo - stats.frames) / (stats.frames / el) / 60).toFixed(1)} min`);
      }
    }
    s.remaining -= b - a;
    if (s.remaining === 0 && FULL && !KEEP) encodeScene(s);
  }
  px.close();
  await browser.close();
}

const { server, origin } = await startServer(PROJECT, CACHE);
log(`rendering frames ${FROM}..${TO - 1} (${todo} to do) with ${WORKERS} workers`);
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i, origin)));
server.close();
log(`capture done: ${stats.frames} frames, ${stats.blurred} blurred (${stats.known} from known windows, ${stats.probed} probed)`);

if (FULL && !KEEP) {
  await allEncoded;
  const list = path.join(RUN, 'segments.txt');
  writeFileSync(list, scenes.map((s) => `file '${s.segFile}'\n`).join(''));
  mkdirSync(path.dirname(OUT), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
  const count = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,r_frame_rate,pix_fmt', '-of', 'compact', OUT]).toString().trim();
  log(`wrote ${OUT}: ${count}`);
  rmSync(RUN, { recursive: true, force: true });
}
log(`total ${((Date.now() - t0) / 60000).toFixed(1)} min`);
