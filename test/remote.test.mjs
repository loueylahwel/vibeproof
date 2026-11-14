import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { scanRepo } from '../dist/checks/repo.js';
import { gitClone, parseRepoUrl, RepoAccessError } from '../dist/remote.js';
import { detectTrack } from '../dist/run.js';
import { FAKE_STRIPE } from '../lab/lab.mjs';

let dir;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vibeproof-remote-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('repository links are parsed into a canonical https clone URL', () => {
  const r = parseRepoUrl('https://github.com/Acme/shop-app');
  assert.equal(r.cloneUrl, 'https://github.com/Acme/shop-app.git');
  assert.equal(r.display, 'https://github.com/Acme/shop-app');

  assert.equal(parseRepoUrl('github.com/acme/app.git').cloneUrl, 'https://github.com/acme/app.git');
  assert.equal(parseRepoUrl('https://www.github.com/acme/app/').repo, 'app');

  const tree = parseRepoUrl('https://github.com/acme/mono/tree/dev/apps/web');
  assert.equal(tree.branch, 'dev');
  assert.equal(tree.subPath, 'apps/web');
  assert.equal(parseRepoUrl('https://gitlab.com/acme/app/-/tree/main').branch, 'main');
  assert.equal(parseRepoUrl('https://bitbucket.org/acme/app/src/main/').branch, 'main');
  assert.equal(parseRepoUrl('https://codeberg.org/acme/app').host, 'codeberg.org');
});

test('anything that is not a public repository link is rejected', () => {
  for (const bad of [
    'https://example.com/acme/app', // unsupported host
    'https://github.com/acme', // no repository
    'https://user:token@github.com/acme/app', // embedded credentials
    'https://github.com/acme/app/tree/main/a%2F..%2F..%2Fetc', // traversal hidden in an encoded slash
    'file:///etc/passwd',
    '~/Documents/app',
  ]) {
    assert.equal(parseRepoUrl(bad), null, bad);
  }
  assert.throws(() => parseRepoUrl('git@github.com:acme/app.git'), RepoAccessError, 'SSH would use private keys');
  // Plain dot segments are collapsed by URL parsing before any folder is taken from the link.
  assert.equal(parseRepoUrl('https://github.com/acme/app/tree/main/../../etc').subPath, undefined);
});

test('scan type: repository links are repository scans, other URLs are web scans', () => {
  assert.equal(detectTrack('https://github.com/acme/app'), 'repo');
  assert.equal(detectTrack('github.com/acme/app'), 'repo');
  assert.equal(detectTrack('git@github.com:acme/app.git'), 'repo');
  assert.equal(detectTrack('https://acme-app.vercel.app'), 'web');
  assert.equal(detectTrack('github.com'), 'web');
});

test('a full clone keeps git history; a latest-commit clone does not', async () => {
  const source = path.join(dir, 'source');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: source, stdio: 'pipe' });
  execFileSync('git', ['init', '-q', '-b', 'main', source]);
  await writeFile(path.join(source, 'pay.ts'), `const k = "${FAKE_STRIPE}";\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'add key');
  await writeFile(path.join(source, 'pay.ts'), 'const k = process.env.STRIPE_KEY;\n');
  git('commit', '-q', '-am', 'remove key');

  const full = path.join(dir, 'full');
  await gitClone(source, full, { history: true });
  const withHistory = await scanRepo(full, { history: true, npmAudit: false });
  assert.ok(withHistory.findings.some((f) => f.ruleId === 'VP-SEC-002' && /git history/.test(f.location)));

  const shallow = path.join(dir, 'shallow');
  await gitClone(`file://${source}`, shallow, { history: false });
  const latest = await scanRepo(shallow, { history: true, npmAudit: false });
  assert.ok(!latest.findings.some((f) => f.ruleId === 'VP-SEC-002'), 'removed key is not in the latest commit');
});

test('a clone that would need credentials fails with a clear message', async () => {
  await assert.rejects(gitClone(path.join(dir, 'does-not-exist'), path.join(dir, 'x'), { history: true }), RepoAccessError);
});
