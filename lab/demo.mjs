// Builds the lab app, scans it with both tracks, and writes sample reports to reports/.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createVulnerableRepo, startVulnerableServer } from './lab.mjs';

// Async on purpose: the lab server runs in this process and must keep answering.
const run = (args) => new Promise((resolve, reject) => {
  spawn('node', args, { stdio: 'inherit' }).on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
});

const cli = path.resolve('dist/cli.js');
const dir = await mkdtemp(path.join(tmpdir(), 'vscan-lab-'));
const server = await startVulnerableServer();
try {
  const repo = path.join(dir, 'lab-vibe-app');
  await createVulnerableRepo(repo);
  await run([cli, 'repo', repo, '--out', 'reports/sample-repo-report.pdf']);
  await run([cli, 'web', `${server.base}/`, '--authorized', '--supabase-url', server.base, '--out', 'reports/sample-web-report.pdf']);
} finally {
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
