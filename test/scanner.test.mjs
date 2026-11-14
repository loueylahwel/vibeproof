import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { scanRepo } from '../dist/checks/repo.js';
import { scanWeb } from '../dist/checks/web.js';
import { writePdf } from '../dist/report/pdf.js';
import { scanSecrets } from '../dist/secrets.js';
import { createVulnerableRepo, fakeJwt, FAKE_STRIPE, REPO_EXPECTED, startVulnerableServer, WEB_EXPECTED } from '../lab/lab.mjs';

let workdir;
before(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'vscan-test-'));
});
after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test('secret patterns: detects real-looking keys, skips placeholders, redacts', () => {
  const hits = scanSecrets(`const a = "${FAKE_STRIPE}";\nconst apiKey = "your_api_key_here_please";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ruleId, 'VSC-SEC-002');
  assert.equal(hits[0].line, 1);
  assert.ok(!hits[0].evidence.includes(FAKE_STRIPE));
});

test('JWT role decoding: service_role is critical, anon is ignored', () => {
  assert.deepEqual(scanSecrets(fakeJwt('anon')), []);
  const [hit] = scanSecrets(fakeJwt('service_role'));
  assert.equal(hit.ruleId, 'VSC-DB-006');
  assert.equal(hit.severity, 'critical');
});

test('repo track finds every planted flaw in the lab app', async () => {
  const dir = path.join(workdir, 'repo');
  await createVulnerableRepo(dir);
  const { findings } = await scanRepo(dir, { history: true, npmAudit: false });
  const ids = new Set(findings.map((f) => f.ruleId));
  for (const id of REPO_EXPECTED) assert.ok(ids.has(id), `missing ${id}`);

  const rls = findings.filter((f) => f.ruleId === 'VSC-DB-001');
  assert.deepEqual(rls.map((f) => f.evidence.match(/"(\w+)"/)[1]), ['profiles']);
  const policy = findings.find((f) => f.ruleId === 'VSC-DB-002');
  assert.equal(policy.severity, 'critical');
  assert.ok(!findings.some((f) => f.evidence.includes('notes')), 'owner-scoped policy must not be flagged');
  assert.ok(!findings.some((f) => f.location.startsWith('supabase/functions')), 'server-only code must not be flagged');

  const history = findings.find((f) => f.ruleId === 'VSC-SEC-002');
  assert.match(history.location, /git history, commit/);

  const serialized = JSON.stringify(findings);
  assert.ok(!serialized.includes(FAKE_STRIPE), 'raw Stripe key leaked into findings');
  assert.ok(!serialized.includes(fakeJwt('service_role')), 'raw JWT leaked into findings');
});

test('web track finds every planted flaw using GET only', async () => {
  const server = await startVulnerableServer();
  try {
    const { findings, notes } = await scanWeb(`${server.base}/`, { supabaseUrl: server.base, maxBundles: 10, maxTables: 10, timeoutMs: 5000 });
    const ids = new Set(findings.map((f) => f.ruleId));
    for (const id of WEB_EXPECTED) assert.ok(ids.has(id), `missing ${id}`);
    const exposed = findings.filter((f) => f.ruleId === 'VSC-DB-005').map((f) => f.location.split('/').pop());
    assert.deepEqual(exposed, ['posts']);
    assert.ok(!JSON.stringify(findings).includes('private draft'), 'row values must not be stored');
    assert.ok(notes.some((n) => n.includes('cdn.example.com')), 'third-party script should be listed as skipped');
  } finally {
    await server.close();
  }
});

test('web track rejects non-http targets', async () => {
  await assert.rejects(scanWeb('file:///etc/passwd', { maxBundles: 1, maxTables: 1, timeoutMs: 1000 }));
});

test('PDF report renders', async () => {
  const out = path.join(workdir, 'report.pdf');
  const finding = { ruleId: 'VSC-DB-001', title: 'T', severity: 'high', track: 'repo', location: 'a.sql:1', evidence: 'e', description: 'd', remediation: 'r', owasp: 'A01', cwe: 'CWE-284' };
  await writePdf({ tool: 't', version: '0', target: '/x', track: 'repo', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', findings: [finding], notes: ['n'] }, out);
  const pdf = await readFile(out);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
});
