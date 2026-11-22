// Scene pages for our own renderer: a tiny HTTP server that serves the project
// plus one generated page shell per scene, and the in-page timing engine
// (clip visibility + timeline seeking) that the renderer drives.
//
// A scene shell reproduces what the old runtime did for one sub-composition:
// the root document's base styles and :root tokens, a 1920x1080 stage, the
// scene's host element (id = scene id, so scene scripts that target "#<id>"
// still find it), and the <template> content (style, markup, script) of
// compositions/<id>.html inlined in order.
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const W = 1920;
export const H = 1080;
const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

// GSAP 3.15.0 from the CDN the scenes already use, cached once on disk.
async function loadGsap(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, 'gsap-3.15.0.min.js');
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch(GSAP_URL);
  if (!res.ok) throw new Error(`gsap download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

// The root document's first <style> block (tokens, reset, html/body), with
// its "#root" rule renamed to "#stage" so it cannot leak onto scene roots.
function baseStyles(project) {
  const index = readFileSync(path.join(project, 'index.html'), 'utf8');
  const m = index.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('index.html has no <style> block');
  return m[1].replace(/#root\b/g, '#stage');
}

function templateContent(project, id) {
  const src = readFileSync(path.join(project, 'compositions', `${id}.html`), 'utf8');
  const m = src.match(/<template[^>]*>([\s\S]*)<\/template>/);
  if (!m) throw new Error(`compositions/${id}.html has no <template>`);
  return m[1];
}

export function buildShell(project, id) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<base href="/" />
<meta name="viewport" content="width=${W}, height=${H}" />
<script src="/__vendor/gsap.min.js"></script>
<style>${baseStyles(project)}
#stage { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; }
#${id} { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
</style>
<script>window.__timelines = window.__timelines || {};</script>
</head>
<body>
<div id="stage">
<div id="${id}" data-composition-id="${id}" data-width="${W}" data-height="${H}">
${templateContent(project, id)}
</div>
</div>
<script src="/__render/runtime.js"></script>
</body>
</html>
`;
}

export async function startServer(project, cacheDir) {
  const gsap = await loadGsap(cacheDir);
  const runtime = readFileSync(new URL('./runtime.js', import.meta.url));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    try {
      if (p === '/__vendor/gsap.min.js') return send(res, 200, MIME['.js'], gsap);
      if (p === '/__render/runtime.js') return send(res, 200, MIME['.js'], runtime);
      const shell = p.match(/^\/__shell\/([\w-]+)\.html$/);
      if (shell) return send(res, 200, MIME['.html'], buildShell(project, shell[1]));
      const file = path.join(project, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if (!file.startsWith(project) || !existsSync(file)) return send(res, 404, 'text/plain', 'not found');
      return send(res, 200, MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', readFileSync(file));
    } catch (err) {
      return send(res, 500, 'text/plain', String(err));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

// Open (or re-point) a page at one scene and wait until it can be seeked.
export async function loadScene(page, origin, id) {
  await page.goto(`${origin}/__shell/${id}.html`, { waitUntil: 'load', timeout: 120000 });
  const info = await page.evaluate((sid) => window.__render.init(sid), id);
  return info;
}

export async function seek(page, t) {
  return page.evaluate((tt) => window.__render.seek(tt), t);
}
