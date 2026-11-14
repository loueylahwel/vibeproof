// Runs both scan tracks against every lab app and scores them against the
// ground truth in lab/catalog.mjs.
//
//   npm run evaluate   writes evaluation/results.json, evaluation/RESULTS.md
//                      and evaluation/evaluation-report.pdf
//
// Definitions
//   planted            flaws in the catalogue (clean controls have none)
//   detected           a flaw counts as detected by a setup when at least one
//                      finding from that setup's tracks matches its rule (and
//                      text, when given) for that track
//   within reach       the flaw leaves evidence where the setup looks; flaws
//                      outside reach can only be missed by design
//   false alarm        a finding that matches no planted flaw of its app
//   precision          share of findings that match a planted flaw
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { scanRepo } from '../dist/checks/repo.js';
import { scanWeb } from '../dist/checks/web.js';
import { writeEvaluationPdf } from '../dist/report/evaluation-pdf.js';
import { VERSION } from '../dist/run.js';
import { APPS } from './catalog.mjs';
import { startDeployment } from './deploy.mjs';

export const SETUPS = { repo: ['repo'], web: ['web'], combined: ['repo', 'web'] };
const SETUP_NAMES = { repo: 'Repository only', web: 'Browser only', combined: 'Combined' };

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=lab', '-c', 'user.email=lab@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

async function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
}

export async function buildRepo(dir, app) {
  await writeFiles(dir, app.repo.files);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Initial version from the app builder');
  if (app.repo.later) {
    await writeFiles(dir, app.repo.later);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Move secrets to environment variables');
  }
}

export function visibility(issue) {
  const r = Boolean(issue.detect.repo?.length);
  const w = Boolean(issue.detect.web?.length);
  return r && w ? 'both' : r ? 'repo' : 'web';
}

function matches(spec, finding) {
  return spec.rule === finding.ruleId && (!spec.match || `${finding.location} ${finding.evidence}`.includes(spec.match));
}

/** Scan one app with both tracks and match every finding to the ground truth. */
export async function evaluateApp(app, workdir) {
  const dir = path.join(workdir, app.name);
  await buildRepo(dir, app);
  const repo = await scanRepo(dir, { history: true, npmAudit: false });

  const deployment = await startDeployment(app.deploy);
  let web;
  try {
    web = await scanWeb(`${deployment.base}/`, {
      supabaseUrl: app.deploy.supabase ? deployment.base : undefined,
      firestoreBase: deployment.base,
      maxBundles: 10,
      maxTables: 25,
      timeoutMs: 5000,
    });
  } finally {
    await deployment.close();
  }

  const tracks = { repo: repo.findings, web: web.findings };
  const detectedBy = Object.fromEntries(app.issues.map((i) => [i.id, { repo: false, web: false }]));
  const falsePositives = [];
  for (const [track, findings] of Object.entries(tracks)) {
    for (const f of findings) {
      const hit = app.issues.filter((i) => (i.detect[track] ?? []).some((spec) => matches(spec, f)));
      hit.forEach((i) => { detectedBy[i.id][track] = true; });
      if (!hit.length) {
        falsePositives.push({ app: app.name, track, ruleId: f.ruleId, title: f.title, severity: f.severity, location: f.location.replace(deployment.base, ''), evidence: f.evidence, clean: Boolean(app.clean), note: app.expectedNoise });
      }
    }
  }
  return {
    app,
    findingCounts: { repo: repo.findings.length, web: web.findings.length },
    issues: app.issues.map((i) => ({ app: app.name, id: i.id, title: i.title, category: i.category, visibility: visibility(i), detectedBy: detectedBy[i.id] })),
    falsePositives,
  };
}

const pct = (n, d) => (d ? n / d : null);

export function score(perApp) {
  const issues = perApp.flatMap((r) => r.issues);
  const fps = perApp.flatMap((r) => r.falsePositives);
  const found = (issue, setup) => SETUPS[setup].some((t) => issue.detectedBy[t]);
  const inReach = (issue, setup) => SETUPS[setup].some((t) => issue.visibility === t || issue.visibility === 'both');

  const setups = Object.keys(SETUPS).map((setup) => {
    const findings = perApp.reduce((n, r) => n + SETUPS[setup].reduce((m, t) => m + r.findingCounts[t], 0), 0);
    const falsePositives = fps.filter((f) => SETUPS[setup].includes(f.track)).length;
    const reachable = issues.filter((i) => inReach(i, setup));
    const detected = issues.filter((i) => found(i, setup)).length;
    return {
      setup,
      name: SETUP_NAMES[setup],
      planted: issues.length,
      detected,
      recall: pct(detected, issues.length),
      reachable: reachable.length,
      detectedInReach: reachable.filter((i) => found(i, setup)).length,
      reachRate: pct(reachable.filter((i) => found(i, setup)).length, reachable.length),
      findings,
      falsePositives,
      precision: pct(findings - falsePositives, findings),
      cleanFalsePositives: fps.filter((f) => f.clean && SETUPS[setup].includes(f.track)).length,
    };
  });

  const group = (key) => [...new Set(issues.map((i) => i[key]))].map((value) => {
    const subset = issues.filter((i) => i[key] === value);
    return {
      [key]: value,
      planted: subset.length,
      ...Object.fromEntries(Object.keys(SETUPS).map((s) => [s, subset.filter((i) => found(i, s)).length])),
    };
  });

  const missedInReach = Object.keys(SETUPS).flatMap((setup) =>
    issues.filter((i) => inReach(i, setup) && !found(i, setup)).map((i) => ({ setup: SETUP_NAMES[setup], app: i.app, id: i.id, title: i.title })));

  const apps = perApp.map((r) => ({
    name: r.app.name,
    stack: r.app.stack,
    story: r.app.story,
    clean: Boolean(r.app.clean),
    planted: r.issues.length,
    detected: Object.fromEntries(Object.keys(SETUPS).map((s) => [s, r.issues.filter((i) => found(i, s)).length])),
    falsePositives: Object.fromEntries(Object.keys(SETUPS).map((s) => [s, r.falsePositives.filter((f) => SETUPS[s].includes(f.track)).length])),
  }));

  return {
    generatedAt: new Date().toISOString(),
    tool: 'vibeproof',
    version: VERSION,
    apps,
    setups,
    byVisibility: group('visibility'),
    byCategory: group('category'),
    issues,
    falsePositives: fps,
    missedInReach,
  };
}

export async function runEvaluation(apps = APPS) {
  const workdir = await mkdtemp(path.join(tmpdir(), 'vibeproof-eval-'));
  try {
    const perApp = [];
    for (const app of apps) perApp.push(await evaluateApp(app, workdir));
    return score(perApp);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

const fmt = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);

export function toMarkdown(r) {
  const lines = [
    '# Vibeproof detection evaluation',
    '',
    `Generated ${r.generatedAt.slice(0, 10)} by vibeproof ${r.version} on ${r.apps.length} lab apps (${r.apps.filter((a) => !a.clean).length} with planted flaws, ${r.apps.filter((a) => a.clean).length} clean controls), ${r.setups[0].planted} planted flaws. Regenerate with \`npm run evaluate\`; the full report is \`evaluation-report.pdf\`.`,
    '',
    '## Summary',
    '',
    '| Setup | Flaws found | Found within reach | Findings | False alarms | Precision | False alarms on clean apps |',
    '|---|---|---|---|---|---|---|',
    ...r.setups.map((s) => `| ${s.name} | ${s.detected}/${s.planted} (${fmt(s.recall)}) | ${s.detectedInReach}/${s.reachable} (${fmt(s.reachRate)}) | ${s.findings} | ${s.falsePositives} | ${fmt(s.precision)} | ${s.cleanFalsePositives} |`),
    '',
    '## By where the flaw leaves evidence',
    '',
    '| Visible in | Planted | Repository only | Browser only | Combined |',
    '|---|---|---|---|---|',
    ...r.byVisibility.map((v) => `| ${{ repo: 'Repository only', web: 'Deployment only', both: 'Both' }[v.visibility]} | ${v.planted} | ${v.repo} | ${v.web} | ${v.combined} |`),
    '',
    '## By category',
    '',
    '| Category | Planted | Repository only | Browser only | Combined |',
    '|---|---|---|---|---|',
    ...r.byCategory.map((c) => `| ${c.category} | ${c.planted} | ${c.repo} | ${c.web} | ${c.combined} |`),
    '',
    '## By app',
    '',
    '| App | Stack | Planted | Repo | Web | Combined | False alarms (repo / web) |',
    '|---|---|---|---|---|---|---|',
    ...r.apps.map((a) => `| ${a.name}${a.clean ? ' (clean)' : ''} | ${a.stack} | ${a.planted} | ${a.detected.repo} | ${a.detected.web} | ${a.detected.combined} | ${a.falsePositives.repo} / ${a.falsePositives.web} |`),
    '',
    '## Missed within reach',
    '',
    ...(r.missedInReach.length ? r.missedInReach.map((m) => `- ${m.setup}: ${m.app} / ${m.title}`) : ['None.']),
    '',
    '## False alarms',
    '',
    ...(r.falsePositives.length
      ? r.falsePositives.map((f) => `- ${f.app} (${f.track}${f.clean ? ', clean control' : ''}): ${f.ruleId} ${f.title}. ${f.evidence}${f.note ? ` _Note: ${f.note}_` : ''}`)
      : ['None.']),
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const result = await runEvaluation();
  const out = path.resolve('evaluation');
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(out, 'RESULTS.md'), toMarkdown(result));
  await writeEvaluationPdf(result, path.join(out, 'evaluation-report.pdf'));

  console.log('\nSetup              Found        In reach     Findings  False alarms  Precision');
  for (const s of result.setups) {
    console.log(`${s.name.padEnd(18)} ${`${s.detected}/${s.planted} ${fmt(s.recall)}`.padEnd(12)} ${`${s.detectedInReach}/${s.reachable} ${fmt(s.reachRate)}`.padEnd(12)} ${String(s.findings).padEnd(9)} ${String(s.falsePositives).padEnd(13)} ${fmt(s.precision)}`);
  }
  if (result.missedInReach.length) console.log(`\nMissed within reach:\n${result.missedInReach.map((m) => `  ${m.setup}: ${m.app} / ${m.title}`).join('\n')}`);
  console.log(`\nFalse alarms: ${result.falsePositives.length}`);
  for (const f of result.falsePositives) console.log(`  ${f.app.padEnd(11)} ${f.track.padEnd(4)} ${f.ruleId}  ${f.evidence.slice(0, 90)}`);
  console.log(`\nWrote evaluation/results.json, evaluation/RESULTS.md, evaluation/evaluation-report.pdf`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
