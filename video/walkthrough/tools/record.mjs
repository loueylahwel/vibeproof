// Screen recording of the real Vibeproof dashboard, driven by a script.
//
//   node video/walkthrough/tools/record.mjs [scratch-dir]
//
// What is real: the dashboard (dist/cli.js dashboard), every scan, every report, the
// PDF. The scanned app is the lab app "taskflow": its repository is built in a scratch
// home folder (so "~/projects/taskflow" is typed literally and the server expands ~),
// and its simulated deployment is served at http://taskflow.localhost:5173.
// The site scan gets the lab Supabase address added (see setRequestInterception below).
// What is added: a drawn mouse pointer (headless Chrome draws none), click rings and
// short step captions. The only text edit: the scratch home folder is shown as "~".
//
// Output: <scratch>/frames/*.jpg (Chrome screencast frames, variable rate) and
// <scratch>/timeline.json (frame times plus clicks, keys and captions for the sound).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const SCRATCH = path.resolve(process.argv[2] ?? path.join(HERE, '../.record'));
const HOME = path.join(SCRATCH, 'home');
const FRAMES = path.join(SCRATCH, 'frames');
const DASH_PORT = 4181;
const SITE_PORT = 5173;

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? '/home/bl9/.npm/_npx/2a702a27d5483266/node_modules/puppeteer-core');
const { APPS } = await import(path.join(REPO_ROOT, 'lab/catalog.mjs'));
const { buildRepo } = await import(path.join(REPO_ROOT, 'lab/evaluate.mjs'));
const { startDeployment } = await import(path.join(REPO_ROOT, 'lab/deploy.mjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(path.join(HOME, 'projects'), { recursive: true });
mkdirSync(FRAMES, { recursive: true });

// 1. The lab app: repository in the scratch home, deployment behind port 5173
const app = APPS.find((a) => a.name === 'taskflow');
await buildRepo(path.join(HOME, 'projects/taskflow'), app);
const SITE = `http://taskflow.localhost:${SITE_PORT}`;
const deployment = await startDeployment({ ...app.deploy, bundle: () => app.deploy.bundle({ base: SITE }) });
const inner = Number(new URL(deployment.base).port);
const proxy = net.createServer((c) => { const u = net.connect(inner, '127.0.0.1'); c.pipe(u).pipe(c); u.on('error', () => c.destroy()); c.on('error', () => u.destroy()); });
await new Promise((r) => proxy.listen(SITE_PORT, '127.0.0.1', r));

// 2. A separate dashboard with an empty history and the scratch home
const dash = spawn(process.execPath, [path.join(REPO_ROOT, 'dist/cli.js'), 'dashboard', '--port', String(DASH_PORT)], {
  cwd: SCRATCH, stdio: 'ignore', env: { ...process.env, HOME },
});
process.on('exit', () => dash.kill());
process.on('uncaughtException', (e) => { console.error(e); dash.kill(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); dash.kill(); process.exit(1); });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${DASH_PORT}/api/info`)).ok) break; } catch { /* starting */ }
  await sleep(200);
}

// 3. Browser, overlay and screencast
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true,
  // A 1280x720 page drawn at 1.5x: the screencast sends 1920x1081 frames (assemble crops to 1080).
  // (setViewport's deviceScaleFactor would not help: the screencast ignores it.)
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none', '--force-device-scale-factor=1.5', '--window-size=1280,806'],
  defaultViewport: null,
});
const page = await browser.newPage();
await page.setBypassCSP(true);
await page.evaluateOnNewDocument(`(${overlay.toString()})(${JSON.stringify(HOME)})`);

// The lab's stand-in Supabase is not on *.supabase.co, so the scanner would not find it in
// the bundle by itself. For the site scan, pass its address the way the CLI's
// --supabase-url flag does. A real app's https://<project>.supabase.co is found unaided.
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().endsWith('/api/scan')) {
    const body = JSON.parse(req.postData() || '{}');
    if (body.target?.startsWith(SITE)) return req.continue({ postData: JSON.stringify({ ...body, supabaseUrl: SITE }) });
  }
  return req.continue();
});

const events = [];
const log = (type, extra = {}) => events.push({ t: now(), type, ...extra });

const frames = [];
const cdp = await page.createCDPSession();
const writes = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  const file = `${String(frames.length).padStart(5, '0')}.jpg`;
  frames.push({ t: metadata.timestamp, file });
  writes.push(writeFile(path.join(FRAMES, file), Buffer.from(data, 'base64')));
});

const DASH = `http://localhost:${DASH_PORT}/`;
await page.goto(DASH, { waitUntil: 'networkidle0' });
await sleep(500);
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
const t0 = now();
// Keep the compositor producing frames on static screens (the cursor overlay ticks).
await page.evaluate(() => window.__vp.keepAlive());

// ---------- helpers ----------
let mouse = { x: 900, y: 520 };
await page.mouse.move(mouse.x, mouse.y);
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
async function moveTo(x, y, ms) {
  const from = { ...mouse };
  const dist = Math.hypot(x - from.x, y - from.y);
  const dur = ms ?? Math.min(1100, 380 + dist * 0.75);
  const bend = Math.min(60, dist * 0.08); // a slight arc, like a hand
  const nx = -(y - from.y) / (dist || 1), ny = (x - from.x) / (dist || 1);
  const start = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - start) / dur);
    const e = ease(k), arc = Math.sin(Math.PI * e) * bend;
    mouse = { x: from.x + (x - from.x) * e + nx * arc, y: from.y + (y - from.y) * e + ny * arc };
    await page.mouse.move(mouse.x, mouse.y);
    if (k >= 1) break;
    await sleep(12);
  }
}
async function box(target) {
  const handle = typeof target === 'string' ? await page.$(target)
    : target.fn ? await page.evaluateHandle(target.fn, target.arg) : await page.evaluateHandle(target);
  const b = await handle?.asElement()?.boundingBox();
  if (!b) { await page.screenshot({ path: path.join(SCRATCH, 'error.png') }); throw new Error(`no element for ${target.arg ?? target.fn ?? target}`); }
  return b;
}
async function point(target, fx = 0.5, fy = 0.5) {
  const b = await box(target);
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
async function hover(target, fx, fy, ms) { const p = await point(target, fx, fy); await moveTo(p.x, p.y, ms); }
async function click(target, fx, fy) {
  await hover(target, fx, fy);
  await sleep(140);
  log('click');
  await page.mouse.down(); await sleep(70); await page.mouse.up();
}
let seed = 7;
const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
async function type(text) {
  for (const ch of text) {
    log('key');
    await page.keyboard.type(ch);
    await sleep(55 + jitter() * 70 + (/[/.:]/.test(ch) ? 90 : 0));
  }
}
async function key(k) { log('key'); await page.keyboard.press(k); }
async function caption(text) { log('caption', { text }); await page.evaluate((s) => window.__vp.caption(s), text); }
async function scrollMain(to, ms = 900) { log('scroll'); await page.evaluate((y, d) => window.__vp.scroll('html', y, d), to, ms); await sleep(ms + 50); }
async function scrollIntoMain(target, offset = 24, ms) {
  const y = await page.evaluate((sel, off) => window.scrollY + document.querySelector(sel).getBoundingClientRect().top - off, target, offset);
  await scrollMain(y, ms);
}
const findingRow = (text) => ({ fn: (t) => [...document.querySelectorAll('.f-row')].find((r) => r.textContent.includes(t)), arg: text });
const startCard = (text) => ({ fn: (t) => [...document.querySelectorAll('.start')].find((r) => r.textContent.includes(t)), arg: text });
const markOpen = () => page.evaluate(() => document.querySelector('.finding.open')?.setAttribute('id', 'vp-open'));
const waitReport = async () => {
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Scan finished') && !t.classList.contains('out')), { timeout: 120000, polling: 'mutation' });
  log('done');
  await page.waitForFunction(() => location.hash.startsWith('#/report/') && document.querySelector('.r-title'), { timeout: 120000 });
};

// ---------- the walkthrough ----------
await sleep(1200);
await caption('Vibeproof runs on your computer. Let\'s scan a test app called TaskFlow.');
await hover(startCard('Public repository'), 0.5, 0.5, 900);
await sleep(500);
await hover(startCard('Live site'), 0.5, 0.5, 700);
await sleep(500);
await sleep(1800);

await caption('1 · Scan the project folder');
await click(startCard('Local folder'));
await sleep(500);
await type('projects/taskflow');
await sleep(1300);
await hover('#detected', 0.3, 0.5, 600);
await sleep(1200);
await click('#run-btn');
await caption('Every check shows live while it runs');
await waitReport();
await sleep(1600);

const nFind = await page.evaluate(() => document.querySelectorAll('.f-row').length);
await caption(`The report: ${nFind} findings, sorted by severity`);
await hover('.r-meta .risk', 0.5, 0.5);
await sleep(1500);
await hover('.tiles .tile:nth-child(2)', 0.5, 0.5);
await sleep(1400);

await caption('Open a finding to see why it matters and how to fix it');
await scrollIntoMain('.findings-wrap', 80);
await sleep(400);
await click(findingRow('Table without row level security'), 0.3, 0.5);
await sleep(900);
await markOpen();
await scrollIntoMain('#vp-open', 24, 1100);
await sleep(1200);
await hover('#vp-open .f-body pre', 0.3, 0.5);
await sleep(2600);
await hover('#vp-open .f-body > div:nth-child(3) p', 0.4, 0.5);
await sleep(2200);

await caption('2 · Get a ready prompt for your AI coding agent');
await click(() => [...document.querySelectorAll('#vp-open .agent .btn')].find((b) => b.textContent.includes('Preview')));
await sleep(900);
await scrollIntoMain('#vp-open .agent', 120, 1100);
await sleep(2600);
await click(() => [...document.querySelectorAll('#vp-open .agent .btn')].find((b) => b.textContent.includes('Copy fix prompt')));
await sleep(2200);
await caption('Or one prompt that covers every finding');
await scrollMain(0, 1100);
await click('.toolbar .btn-primary');
await sleep(2400);

// The PDF the button opens, as page images (pdftoppm), shown over the page in the recording.
const reportId = await page.evaluate(() => decodeURIComponent(location.hash.split('/').pop()));
const pdfBase = path.join(SCRATCH, 'pdf');
{ // the same "~" edit inside the PDF: rewrite the report with the short path and redraw its PDF
  const { writePdf } = await import(path.join(REPO_ROOT, 'dist/report/pdf.js'));
  const fs = require('node:fs');
  const json = path.join(SCRATCH, 'reports', `${reportId}.json`);
  const report = JSON.parse(fs.readFileSync(json, 'utf8').split(HOME).join('~'));
  fs.writeFileSync(json, JSON.stringify(report, null, 2));
  await writePdf(report, path.join(SCRATCH, 'reports', `${reportId}.pdf`));
}
execFileSync('pdftoppm', ['-r', '160', '-png', '-f', '1', '-l', '3', path.join(SCRATCH, 'reports', `${reportId}.pdf`), pdfBase]);
const pdfPages = (await import('node:fs')).readdirSync(SCRATCH).filter((f) => f.startsWith('pdf-') && f.endsWith('.png')).sort()
  .map((f) => `data:image/png;base64,${(require('node:fs')).readFileSync(path.join(SCRATCH, f)).toString('base64')}`);
await page.evaluate((p) => { window.__vpPdfPages = p; }, pdfPages);
await caption('3 · A PDF report to hand in or share');
await click('.r-actions .btn-secondary');
await sleep(2000);
await page.evaluate(() => window.__vp.scroll('#pdf', 1200, 3200)); log('scroll');
await sleep(3400);
await page.evaluate(() => window.__vp.scroll('#pdf', 2600, 2600)); log('scroll');
await sleep(2800);
await page.evaluate(() => window.__vp.closePdf()); log('click');
await sleep(900);

await caption('4 · Live sites: Vibeproof first asks for proof that you own them');
await click('#target');
await type('example.com');
await sleep(700);
await click('#run-btn');
await page.waitForSelector('#verify:not([hidden])', { timeout: 60000 });
await sleep(600);
await hover('#verify-file', 0.4, 0.5);
await sleep(1800);
await hover('#verify-dns', 0.4, 0.5);
await sleep(2600);

await caption('5 · The test app runs on this computer, so it can be scanned right away');
await click('#target');
await sleep(300);
await page.keyboard.down('Control'); await key('a'); await page.keyboard.up('Control');
await sleep(250);
await key('Backspace');
await sleep(300);
await type(SITE);
await sleep(1200);
await hover('#detected', 0.3, 0.5, 600);
await sleep(1000);
await click('#run-btn');
await caption('Live checks only read: they never change anything on the site');
await waitReport();
await sleep(1800);
await caption('Click a severity to show only those findings');
await click('.tiles .tile:nth-child(1)');
await sleep(2200);
await click('.tiles .tile:nth-child(1)');
await sleep(1200);
await caption('The live site shows what an attacker sees');
await scrollIntoMain('.findings-wrap', 80);
await sleep(500);
await click(findingRow('readable with the public anon key'), 0.3, 0.5);
await sleep(900);
await markOpen();
await scrollIntoMain('#vp-open', 24, 1100);
await sleep(800);
await hover('#vp-open .f-body pre', 0.3, 0.5);
await caption('Proof: the todos table answers anyone with the public key');
await sleep(3800);

await caption('6 · Every scan stays in History, on this computer');
await hover('#history .h-item:nth-of-type(1)', 0.5, 0.5);
await sleep(1100);
await click(() => [...document.querySelectorAll('#history .h-item')].find((b) => b.textContent.includes('taskflow') && !b.textContent.includes('localhost')));
await page.waitForFunction(() => document.querySelector('.r-title')?.textContent === 'taskflow', { timeout: 20000 });
await sleep(2200);
await caption('Vibeproof · scan the code and the live site');
await moveTo(1000, 640, 1200);
await sleep(3500);
await caption('');
await sleep(1200);

// ---------- finish ----------
await cdp.send('Page.stopScreencast');
const t1 = now();
await Promise.all(writes);
await browser.close();
dash.kill();
proxy.close();
await deployment.close();
writeFileSync(path.join(SCRATCH, 'timeline.json'), JSON.stringify({ t0, t1, frames, events }, null, 1));
console.log(`${frames.length} frames over ${(t1 - t0).toFixed(1)} s -> ${SCRATCH}`);

// ---------- in-page overlay (runs in every document) ----------
function overlay(HOME) {
  const css = `
  #vp-cursor{position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
  #vp-ring{position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid #fff;opacity:0;z-index:2147483646;pointer-events:none}
  #vp-ring.on{animation:vp-ring .45s ease-out}
  @keyframes vp-ring{from{opacity:.75;transform:scale(.4)}to{opacity:0;transform:scale(1.35)}}
  #vp-cap{position:fixed;left:50%;bottom:26px;transform:translate(-50%,8px);max-width:880px;padding:11px 20px;border-radius:12px;
    background:rgba(12,12,14,.88);border:1px solid rgba(255,255,255,.14);color:#f4f4f5;font:500 17px/1.35 Inter,system-ui,sans-serif;
    letter-spacing:-.005em;text-align:center;opacity:0;transition:opacity .35s ease,transform .35s ease;z-index:2147483645;pointer-events:none;
    box-shadow:0 10px 30px rgba(0,0,0,.45);backdrop-filter:blur(8px)}
  #vp-cap.on{opacity:1;transform:translate(-50%,0)}
  #vp-tick{position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:.01;pointer-events:none}
  #pdf{position:fixed;inset:0;z-index:2147483600;background:#2a2a2e;overflow:auto;padding:28px 0 120px;opacity:0;transition:opacity .3s}
  #pdf.on{opacity:1}
  #pdf .bar{position:sticky;top:-28px;margin:-28px 0 24px;height:44px;background:#38383d;color:#ddd;font:500 13px Inter,system-ui,sans-serif;display:flex;align-items:center;padding:0 18px;gap:12px}
  #pdf img{display:block;width:720px;margin:0 auto 18px;box-shadow:0 4px 18px rgba(0,0,0,.5)}`;
  const shown = (s) => (HOME ? s.split(HOME).join('~') : s);
  const tidy = (root) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes(HOME)) n.nodeValue = shown(n.nodeValue);
    root.querySelectorAll?.('[title]').forEach((e) => { if (e.title.includes(HOME)) e.title = shown(e.title); });
  };
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = css; document.head.append(style);
    const cur = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cur.id = 'vp-cursor'; cur.setAttribute('viewBox', '0 0 22 22');
    cur.innerHTML = '<path d="M3 2 L3 17.5 L7 13.8 L9.6 19.6 L12.4 18.4 L9.9 12.7 L15.3 12.7 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/>';
    const ring = document.createElement('div'); ring.id = 'vp-ring';
    const cap = document.createElement('div'); cap.id = 'vp-cap';
    const tick = document.createElement('div'); tick.id = 'vp-tick';
    document.body.append(cur, ring, cap, tick);
    let pos = { x: 900, y: 520 };
    const place = () => { cur.style.transform = `translate(${pos.x - 3}px,${pos.y - 2}px)`; };
    place();
    document.addEventListener('mousemove', (e) => { pos = { x: e.clientX, y: e.clientY }; place(); }, true);
    document.addEventListener('mousedown', (e) => {
      ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`;
      ring.classList.remove('on'); void ring.offsetWidth; ring.classList.add('on');
    }, true);
    // The PDF button opens a tab; in the recording the PDF is shown over the page instead.
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href$=".pdf"]');
      if (!a) return;
      e.preventDefault(); e.stopPropagation();
      window.__vp.openPdf(a.getAttribute('href'));
    }, true);
    if (HOME) {
      tidy(document.body);
      new MutationObserver((ms) => { for (const m of ms) { m.addedNodes.forEach((n) => (n.nodeType === 3 ? (n.nodeValue.includes(HOME) && (n.nodeValue = shown(n.nodeValue))) : n.nodeType === 1 && tidy(n))); if (m.type === 'characterData' && m.target.nodeValue.includes(HOME)) m.target.nodeValue = shown(m.target.nodeValue); } })
        .observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    window.__vp = {
      caption(text) {
        if (!text) { cap.classList.remove('on'); return; }
        if (cap.classList.contains('on')) {
          cap.classList.remove('on');
          setTimeout(() => { cap.textContent = text; cap.classList.add('on'); }, 260);
        } else { cap.textContent = text; cap.classList.add('on'); }
      },
      scroll(sel, to, ms) {
        const el = document.querySelector(sel); const from = el.scrollTop; const s = performance.now();
        const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
        const step = (n) => { const k = Math.min(1, (n - s) / ms); el.scrollTop = from + (to - from) * e(k); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
      },
      keepAlive() { let i = 0; const f = () => { tick.style.opacity = (i++ % 2 ? '.01' : '.02'); requestAnimationFrame(f); }; requestAnimationFrame(f); },
      async openPdf(href) {
        const box = document.createElement('div'); box.id = 'pdf';
        const bar = document.createElement('div'); bar.className = 'bar'; bar.textContent = href.split('/').pop();
        box.append(bar);
        for (const src of window.__vpPdfPages || []) { const img = document.createElement('img'); img.src = src; box.append(img); }
        document.body.append(box); requestAnimationFrame(() => box.classList.add('on'));
      },
      closePdf() { const b = document.querySelector('#pdf'); if (b) { b.classList.remove('on'); setTimeout(() => b.remove(), 320); } },
    };
  });
}
