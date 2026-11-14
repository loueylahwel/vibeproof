import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { scanRepo } from '../dist/checks/repo.js';
import { scanWeb } from '../dist/checks/web.js';
import { writePdf } from '../dist/report/pdf.js';
import { scanSecrets } from '../dist/secrets.js';
import { createVulnerableRepo, fakeJwt, FAKE_STRIPE, REPO_EXPECTED, REPO_SAFE, startVulnerableServer, WEB_EXPECTED } from '../lab/lab.mjs';

let workdir;
before(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), 'vibeproof-test-'));
});
after(async () => {
  await rm(workdir, { recursive: true, force: true });
});

test('secret patterns: detects real-looking keys, skips placeholders, redacts', () => {
  const hits = scanSecrets(`const a = "${FAKE_STRIPE}";\nconst apiKey = "your_api_key_here_please";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].ruleId, 'VP-SEC-002');
  assert.equal(hits[0].line, 1);
  assert.ok(!hits[0].evidence.includes(FAKE_STRIPE));
});

test('JWT role decoding: service_role is critical, anon is ignored', () => {
  assert.deepEqual(scanSecrets(fakeJwt('anon')), []);
  const [hit] = scanSecrets(fakeJwt('service_role'));
  assert.equal(hit.ruleId, 'VP-DB-006');
  assert.equal(hit.severity, 'critical');
});

test('repo track finds every planted flaw in the lab app', async () => {
  const dir = path.join(workdir, 'repo');
  await createVulnerableRepo(dir);
  const { findings } = await scanRepo(dir, { history: true, npmAudit: false });
  const ids = new Set(findings.map((f) => f.ruleId));
  for (const id of REPO_EXPECTED) assert.ok(ids.has(id), `missing ${id}`);

  const rls = findings.filter((f) => f.ruleId === 'VP-DB-001');
  assert.deepEqual(rls.map((f) => f.evidence.match(/"(\w+)"/)[1]), ['profiles']);
  const policy = findings.find((f) => f.ruleId === 'VP-DB-002');
  assert.equal(policy.severity, 'critical');
  assert.ok(!findings.some((f) => f.evidence.includes('notes')), 'owner-scoped policy must not be flagged');
  assert.ok(!findings.some((f) => f.ruleId === 'VP-DB-004' && f.location.startsWith('supabase/functions')), 'server-only code is not client exposure');

  // New backend checks: severities and false-positive controls
  const sev = (id, text) => findings.find((f) => f.ruleId === id && f.evidence.includes(text))?.severity;
  assert.equal(sev('VP-STO-001', 'invoices'), 'critical', 'anonymous upload policy');
  assert.equal(sev('VP-STO-002', 'avatars'), 'low');
  assert.ok(!findings.some((f) => f.ruleId.startsWith('VP-STO') && f.evidence.includes('owners read')), 'owner-scoped storage policy');
  for (const safe of REPO_SAFE.functions) {
    assert.ok(!findings.some((f) => f.ruleId.match(/VP-DB-00[78]/) && f.evidence.includes(safe)), `${safe} must not be flagged`);
  }
  assert.ok(sev('VP-DB-007', 'delete_user'));
  assert.ok(sev('VP-DB-008', 'delete_user'));
  for (const safe of REPO_SAFE.edgeFunctions) {
    assert.ok(!findings.some((f) => f.ruleId.startsWith('VP-FN') && f.location.includes(`/${safe}/`)), `${safe} must not be flagged`);
  }
  assert.equal(sev('VP-FN-001', '"admin"'), 'high');
  assert.ok(sev('VP-FN-002', 'public-export'));
  assert.equal(sev('VP-FB-001', 'allow read, write;'), 'critical', 'storage.rules open write');
  assert.equal(sev('VP-FB-001', '.read'), 'high', 'database.rules.json open read');
  assert.ok(sev('VP-FB-002', 'match /{document=**}: allow read, write: if request.time'));
  assert.ok(sev('VP-FB-001', 'match /{allPaths=**}'));
  assert.ok(!findings.some((f) => f.evidence.includes('request.auth.uid == userId')), 'owner-scoped Firestore rule');
  assert.ok(!findings.some((f) => f.ruleId === 'VP-DB-002' && f.evidence.includes('storage')), 'storage policies are not public tables');

  const history = findings.find((f) => f.ruleId === 'VP-SEC-002');
  assert.match(history.location, /git history, commit/);

  const serialized = JSON.stringify(findings);
  assert.ok(!serialized.includes(FAKE_STRIPE), 'raw Stripe key leaked into findings');
  assert.ok(!serialized.includes(fakeJwt('service_role')), 'raw JWT leaked into findings');
});

test('web track finds every planted flaw using GET only', async () => {
  const server = await startVulnerableServer();
  try {
    const { findings, notes } = await scanWeb(`${server.base}/`, { supabaseUrl: server.base, firestoreBase: server.base, maxBundles: 10, maxTables: 10, timeoutMs: 5000 });
    const ids = new Set(findings.map((f) => f.ruleId));
    for (const id of WEB_EXPECTED) assert.ok(ids.has(id), `missing ${id}`);
    const exposed = findings.filter((f) => f.ruleId === 'VP-DB-005').map((f) => f.location.split('/').pop()).sort();
    assert.deepEqual(exposed, ['audit_log', 'posts'], 'audit_log is only reachable through schema discovery');
    assert.ok(notes.some((n) => n.includes('only through the API schema') && n.includes('audit_log')));
    const buckets = findings.filter((f) => f.ruleId === 'VP-STO-002').map((f) => f.evidence);
    assert.equal(buckets.length, 1);
    assert.match(buckets[0], /avatars/);
    const firebase = findings.filter((f) => f.ruleId === 'VP-FB-003').map((f) => f.location);
    assert.equal(firebase.length, 2, 'Realtime Database root and the orders collection');
    const serialized = JSON.stringify(findings);
    for (const value of ['private draft', 'a@b.c', '"42"']) assert.ok(!serialized.includes(value), `value ${value} must not be stored`);
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
  const finding = { ruleId: 'VP-DB-001', title: 'T', severity: 'high', track: 'repo', location: 'a.sql:1', evidence: 'e', description: 'd', remediation: 'r', owasp: 'A01', cwe: 'CWE-284' };
  await writePdf({ tool: 't', version: '0', target: '/x', track: 'repo', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', findings: [finding], notes: ['n'] }, out);
  const pdf = await readFile(out);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
});

test('lazily loaded chunks are discovered from import(), Vite and Next.js references', async () => {
  const { chunkReferences } = await import('../dist/checks/web.js');
  const refs = chunkReferences('import("./a.js");m.f=["assets/b-1.js"];x("/_next/static/chunks/c.js");y="other.css"');
  assert.deepEqual(refs, [
    { path: './a.js', fromRoot: false },
    { path: 'assets/b-1.js', fromRoot: true },
    { path: '_next/static/chunks/c.js', fromRoot: true },
  ]);
});

test('policies trusting any signed-in user: writes flagged, reads not', async () => {
  const { auditSql } = await import('../dist/checks/repo.js');
  const sql = `create table public.t (id int);
alter table public.t enable row level security;
create policy "w" on public.t for update to authenticated using ((select auth.role()) = 'authenticated');
create policy "d" on public.t for delete to authenticated using (auth.uid() IS NOT NULL);
create policy "r" on public.t for select to authenticated using (auth.uid() is not null);
create policy "own" on public.t for update to authenticated using (auth.uid() = owner);`;
  const found = auditSql([{ rel: 'm.sql', text: sql }], []).filter((f) => f.ruleId === 'VP-DB-002');
  assert.deepEqual(found.map((f) => f.evidence.match(/Policy "(\w+)"/)[1]), ['w', 'd']);
  assert.ok(found.every((f) => f.severity === 'high'));
});

test('Supabase sb_secret_ keys are critical', () => {
  const [hit] = scanSecrets('const k = "' + 'sb_' + 'secret_' + 'abcdEFGH1234abcdEFGH1234' + '";');
  assert.equal(hit.ruleId, 'VP-DB-006');
  assert.equal(hit.severity, 'critical');
});
