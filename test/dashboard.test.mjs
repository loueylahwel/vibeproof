import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startDashboard } from '../dist/dashboard/server.js';
import { createVulnerableRepo } from '../lab/lab.mjs';

let dir;
let dash;
let port;

/** Raw request so the test can set Host and Origin freely (fetch cannot). */
function request(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `localhost:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const scan = (payload, headers = {}) =>
  request('POST', '/api/scan', { headers: { 'content-type': 'application/json', 'x-vscan': '1', ...headers }, body: JSON.stringify(payload) });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vscan-dash-'));
  process.env.VSCAN_KEY_FILE = path.join(dir, 'key');
  dash = await startDashboard({ port: 0, reportsDir: path.join(dir, 'reports'), quiet: true });
  port = Number(new URL(dash.url).port);
});
after(async () => {
  await dash.close();
  await rm(dir, { recursive: true, force: true });
});

test('serves the UI with security headers', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('rejects foreign Host headers (DNS rebinding)', async () => {
  const res = await request('GET', '/api/reports', { headers: { host: 'evil.example:80' } });
  assert.equal(res.status, 403);
});

test('rejects state-changing requests without the x-vscan header (CSRF)', async () => {
  const res = await request('POST', '/api/scan', { headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('rejects cross-origin requests even with the header', async () => {
  const res = await scan({ track: 'repo', target: dir }, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('web scans of unverified domains return the verification token instead of scanning', async () => {
  const res = await scan({ target: 'https://unverified.invalid/' });
  assert.equal(res.status, 403);
  const { verification } = JSON.parse(res.body);
  assert.equal(verification.verified, false);
  assert.equal(verification.host, 'unverified.invalid');
  assert.match(verification.token, /^vscan-[0-9a-f]{32}$/);
  assert.equal(verification.fileUrl, 'https://unverified.invalid/.well-known/vscan-verification.txt');
});

test('scan type is detected from the target', async () => {
  const res = await scan({ target: 'unverified.invalid' });
  assert.equal(JSON.parse(res.body).verification.host, 'unverified.invalid');
});

test('report ids cannot escape the reports folder', async () => {
  await writeFile(path.join(dir, 'secret.json'), '{"findings":[]}');
  for (const p of ['/api/reports/..%2Fsecret', '/reports/..%2Fsecret.json', '/api/reports/.hidden']) {
    const res = await request('GET', p);
    assert.equal(res.status, 404, p);
  }
});

test('full flow: scan a repo, list it, fetch PDF, delete it', async () => {
  const repo = path.join(dir, 'lab');
  await createVulnerableRepo(repo);
  const res = await scan({ track: 'repo', target: repo });
  assert.equal(res.status, 200, res.body);
  const summary = JSON.parse(res.body);
  assert.ok(summary.counts.critical >= 1);

  const list = JSON.parse((await request('GET', '/api/reports')).body);
  assert.equal(list[0].id, summary.id);

  const pdf = await request('GET', `/reports/${summary.id}.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');

  const del = await request('DELETE', `/api/reports/${summary.id}`, { headers: { 'x-vscan': '1' } });
  assert.equal(del.status, 200);
  assert.equal(JSON.parse((await request('GET', '/api/reports')).body).length, 0);
});
