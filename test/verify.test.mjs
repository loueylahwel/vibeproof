import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { detectTrack } from '../dist/run.js';
import { isLocalHost, tokenFor, verifyOwnership } from '../dist/verify.js';

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vscan-verify-'));
  process.env.VSCAN_KEY_FILE = path.join(dir, 'key');
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function serveToken(body) {
  const server = http.createServer((req, res) => {
    if (req.url === '/.well-known/vscan-verification.txt') res.writeHead(200).end(body);
    else res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) };
}

test('tokens are stable per host and differ between hosts', () => {
  assert.equal(tokenFor('example.com'), tokenFor('EXAMPLE.com'));
  assert.notEqual(tokenFor('example.com'), tokenFor('example.org'));
});

test('localhost counts as owned', async () => {
  for (const h of ['localhost', '127.0.0.1', 'app.localhost', '[::1]']) assert.ok(isLocalHost(h), h);
  const v = await verifyOwnership('http://localhost:3000/');
  assert.equal(v.verified, true);
  assert.equal(v.method, 'local');
});

test('verification file with the right token proves ownership', async () => {
  const site = await serveToken(`${tokenFor('127.0.0.1')}\n`);
  try {
    const v = await verifyOwnership(site.base, { trustLocal: false });
    assert.equal(v.verified, true);
    assert.equal(v.method, 'file');
  } finally {
    await site.close();
  }
});

test('wrong token does not prove ownership', async () => {
  const site = await serveToken(tokenFor('someone-else.example'));
  try {
    const v = await verifyOwnership(site.base, { trustLocal: false, timeoutMs: 2000 });
    assert.equal(v.verified, false);
    assert.ok(v.checks.some((c) => c.includes('does not contain the token')), 'failure must explain itself');
    assert.ok(v.checks.some((c) => c.startsWith('DNS')), 'DNS result must be reported');
  } finally {
    await site.close();
  }
});

test('scan type detection', () => {
  assert.equal(detectTrack('https://app.example.com'), 'web');
  assert.equal(detectTrack('forkfolio.dev'), 'web');
  assert.equal(detectTrack('~/Documents/app'), 'repo');
  assert.equal(detectTrack('/home/me/app'), 'repo');
  assert.equal(detectTrack('../app'), 'repo');
});
