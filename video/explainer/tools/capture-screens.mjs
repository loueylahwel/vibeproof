// Captures real Vibeproof screens for the explainer video.
//
//   node tools/capture-screens.mjs <scratch-dir>
//
// It builds the lab app "taskflow" (repository + simulated deployment), runs a
// separate dashboard on port 4180 with its own empty reports folder (so the
// real scan history is untouched), scans taskflow both ways through the
// dashboard API, and screenshots each state at 2x into assets/screens/.
// The only cosmetic edit: the long temporary path of the lab repository is
// shown as ~/projects/taskflow.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PROJECT, '../..');
const OUT = path.join(PROJECT, 'assets/screens');
const SCRATCH = path.resolve(process.argv[2] ?? path.join(PROJECT, '.capture'));
const PORT = 4180;
const SHOWN_PATH = '~/projects/taskflow';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? '/home/bl9/.npm/_npx/2a702a27d5483266/node_modules/puppeteer-core');
const { APPS } = await import(path.join(REPO_ROOT, 'lab/catalog.mjs'));
const { buildRepo } = await import(path.join(REPO_ROOT, 'lab/evaluate.mjs'));
const { startDeployment } = await import(path.join(REPO_ROOT, 'lab/deploy.mjs'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(path.join(SCRATCH, 'reports'), { recursive: true });
mkdirSync(OUT, { recursive: true });

// 1. Lab app: repository and deployment (shown as taskflow.localhost)
const app = APPS.find((a) => a.name === 'taskflow');
const repoDir = path.join(SCRATCH, 'taskflow');
await buildRepo(repoDir, app);
const deployment = await startDeployment({
  ...app.deploy,
  bundle: ({ base }) => app.deploy.bundle({ base: base.replace('127.0.0.1', 'taskflow.localhost') }),
});
const site = deployment.base.replace('127.0.0.1', 'taskflow.localhost');

// 2. Separate dashboard with an empty history
const dash = spawn(process.execPath, [path.join(REPO_ROOT, 'dist/cli.js'), 'dashboard', '--port', String(PORT)], { cwd: SCRATCH, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/info`)).ok) break; } catch { /* starting */ }
  await sleep(200);
}
const scan = async (body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-vibeproof': '1' }, body: JSON.stringify(body) });
  return res.json();
};

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--force-color-profile=srgb'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

const tidy = () => page.evaluate((from, to) => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes(from)) n.nodeValue = n.nodeValue.split(from).join(to);
  const input = document.querySelector('#target');
  if (input?.value.includes(from)) input.value = input.value.split(from).join(to);
}, repoDir, SHOWN_PATH);
const shot = async (name, opts = {}) => {
  await tidy();
  await sleep(250);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...opts });
  console.log(`screens/${name}.png`);
};
const go = async (hash) => {
  // A full load each time: a hash-only change would keep state from the previous screen.
  await page.goto('about:blank');
  await page.goto(`http://localhost:${PORT}/${hash}`, { waitUntil: 'networkidle0' });
  await sleep(600);
};

// 3. Screens
await go('#/');
await shot('welcome');

await page.evaluate((p) => { const i = document.querySelector('#target'); i.value = p; i.dispatchEvent(new Event('input')); }, SHOWN_PATH);
await shot('typed');

await page.evaluate((p) => {
  const progress = renderScanning(p, 'repo'); // eslint-disable-line no-undef
  progress.stop();
  document.querySelector('#topline').classList.add('on');
  document.querySelector('#run-btn').classList.add('busy');
  const list = document.querySelector('.stages');
  const stages = ['Reading files', 'Checking database rules and backend configuration', 'Scanning git history'];
  list.replaceChildren(...stages.map((s, i) => {
    const li = document.createElement('li');
    li.className = `stage ${i < stages.length - 1 ? 'done' : 'current'}`;
    const mark = document.createElement('span');
    mark.className = 'mark';
    if (i < stages.length - 1) mark.append(icon('check')); // eslint-disable-line no-undef
    const label = document.createElement('span');
    label.textContent = s;
    li.append(mark, label);
    return li;
  }));
  document.querySelector('.elapsed').textContent = '0.6 s elapsed';
}, SHOWN_PATH);
await shot('scanning');

const repoScan = await scan({ target: repoDir });
await go(`#/report/${repoScan.id}`);
await shot('report-repo');

const openFinding = async (text) => {
  await page.evaluate((t) => [...document.querySelectorAll('.f-row')].find((r) => r.textContent.includes(t))?.click(), text);
  await sleep(500);
};
await openFinding('Table without row level security');
await page.evaluate(() => document.querySelector('.finding.open').scrollIntoView({ block: 'start' }));
await page.evaluate(() => document.querySelector('#main').scrollBy(0, -24));
await shot('finding-repo');

await page.evaluate(() => [...document.querySelectorAll('.finding.open .btn')].find((b) => b.textContent.includes('Preview'))?.click());
await sleep(500);
await page.evaluate(() => document.querySelector('.finding.open .agent').scrollIntoView({ block: 'start' }));
await page.evaluate(() => document.querySelector('#main').scrollBy(0, -140));
await shot('prompt');

const webScan = await scan({ target: `${site}/`, supabaseUrl: site });
await go(`#/report/${webScan.id}`);
await shot('report-web');
await openFinding('Table readable with the public anon key');
await page.evaluate(() => document.querySelector('.finding.open').scrollIntoView({ block: 'start' }));
await page.evaluate(() => document.querySelector('#main').scrollBy(0, -24));
await shot('finding-web');

// Ownership check for a domain without the token (example.com is reserved for documentation)
await go('#/');
await page.evaluate(() => { const i = document.querySelector('#target'); i.value = 'example.com'; i.dispatchEvent(new Event('input')); document.querySelector('#run-btn').click(); });
await page.waitForSelector('#verify:not([hidden])', { timeout: 60000 });
await sleep(400);
await shot('verify');

await browser.close();
dash.kill();
await deployment.close();

// 4. PDF report pages
const pdf = path.join(SCRATCH, 'reports', `${webScan.id}.pdf`);
execFileSync('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', '3', pdf, path.join(OUT, 'pdf-web')]);
console.log('screens/pdf-web-*.png');
console.log(JSON.stringify({ repoFindings: repoScan.counts, webFindings: webScan.counts, site }));
