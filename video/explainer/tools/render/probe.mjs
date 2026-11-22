// Render single frames (no blur) at given film times, for checks.
//   node tools/render/probe.mjs <outDir> <t1> [t2 ...]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, loadScene, seek, W, H } from './scene-page.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE ?? '/home/bl9/.npm/_npx/2a702a27d5483266/node_modules/puppeteer-core');
import { CHROME_ARGS, CHROME, CACHE } from './config.mjs';

const [outDir, ...times] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { scenes } = JSON.parse(readFileSync(path.join(PROJECT, 'tools/cues.json'), 'utf8'));
const { server, origin } = await startServer(PROJECT, CACHE);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 } });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await page.createCDPSession();
let loaded = null;
for (const ts of times) {
  const T = parseFloat(ts);
  const sc = scenes.find((s) => T >= s.start && T < s.start + s.duration);
  if (loaded !== sc.id) {
    const info = await loadScene(page, origin, sc.id);
    console.log(sc.id, JSON.stringify(info));
    loaded = sc.id;
  }
  await seek(page, T - sc.start);
  const t0 = Date.now();
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  const ms = Date.now() - t0;
  const file = path.join(outDir, `t${T.toFixed(3)}.png`);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(file, ms + 'ms');
}
await browser.close();
server.close();
