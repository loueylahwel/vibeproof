import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  ascii, bullets, contentWidth, ensureSpace, heading, INK, MARGIN, MUTED, pageChrome, para, RULE_LINE, subheading, table, type Doc,
} from './pdf.js';

/** Shape produced by lab/evaluate.mjs for one set of lab apps. */
export interface SetupMetrics {
  setup: 'repo' | 'web' | 'combined';
  name: string;
  planted: number;
  detected: number;
  recall: number | null;
  reachable: number;
  detectedInReach: number;
  reachRate: number | null;
  findings: number;
  falsePositives: number;
  precision: number | null;
  cleanFalsePositives: number;
}

type PerSetup = { repo: number; web: number; combined: number };

export interface EvaluationResult {
  generatedAt: string;
  tool: string;
  version: string;
  apps: { name: string; stack: string; story: string; clean: boolean; planted: number; detected: PerSetup; falsePositives: PerSetup }[];
  setups: SetupMetrics[];
  byVisibility: ({ visibility: 'repo' | 'web' | 'both'; planted: number } & PerSetup)[];
  byCategory: ({ category: string; planted: number } & PerSetup)[];
  issues: { app: string; id: string; title: string; category: string; visibility: string; detectedBy: { repo: boolean; web: boolean } }[];
  falsePositives: { app: string; track: string; ruleId: string; title: string; severity: string; location: string; evidence: string; clean: boolean; note?: string }[];
  missedInReach: { setup: string; app: string; id: string; title: string }[];
}

export interface EvaluationInput {
  /** Development set: used while building the scanner. */
  dev: EvaluationResult;
  /** Held-out set: written and scored before the gap fixes. */
  holdout: EvaluationResult;
  /** Both sets scored with the scanner before the gap fixes, if a snapshot exists. */
  baseline: { dev: EvaluationResult; holdout: EvaluationResult } | null;
}

const SHADE = { repo: '#7a7a7a', web: '#b0b0b0', combined: '#000000' } as const;
const VISIBILITY_LABEL: Record<string, string> = { repo: 'Repository only', web: 'Deployment only', both: 'Both' };
const SETS = [['dev', 'Development set'], ['holdout', 'Held-out set']] as const;

const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const frac = (n: number, d: number) => `${n}/${d} (${pct(d ? n / d : null)})`;
const bold0 = (_r: number, c: number) => (c === 0 ? { bold: true } : {});

function cover(doc: Doc, input: EvaluationInput, id: string): void {
  const { dev, holdout } = input;
  const cw = contentWidth(doc);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('RESEARCH RESULTS', MARGIN, 72, { characterSpacing: 2.5, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(id, MARGIN, 72, { width: cw, align: 'right', lineBreak: false });
  doc.moveTo(MARGIN, 90).lineTo(MARGIN + cw, 90).lineWidth(2.5).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(30).fillColor(INK).text('Detection Evaluation', MARGIN, 128, { width: cw });
  doc.font('Helvetica').fontSize(12.5).fillColor(MUTED)
    .text('Repository access versus browser-only scanning of vibe-coded web apps', MARGIN, doc.y + 12, { width: cw });
  doc.moveTo(MARGIN, doc.y + 22).lineTo(MARGIN + cw, doc.y + 22).lineWidth(0.6).strokeColor(INK).stroke();
  doc.y += 50;

  const describe = (r: EvaluationResult) => {
    const v = r.apps.filter((a) => !a.clean).length;
    return `${r.apps.length} apps (${v} with planted flaws, ${r.apps.length - v} clean), ${r.setups[0].planted} planted flaws`;
  };
  table(doc, [{ header: 'Evaluation details', width: 150 }, { header: '', width: cw - 150 }], [
    ['Development set', describe(dev)],
    ['Held-out set', describe(holdout)],
    ['Setups compared', dev.setups.map((s) => s.name).join(', ')],
    ['Before and after', input.baseline ? 'Both sets scored before and after closing the gaps found on the development set' : 'No baseline snapshot'],
    ['Tool', `${dev.tool} ${dev.version}`],
    ['Generated', dev.generatedAt],
    ['Report ID', id],
  ], bold0);

  doc.moveTo(MARGIN, doc.page.height - 162).lineTo(MARGIN + cw, doc.page.height - 162).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'All apps in this evaluation are synthetic and run on the local machine. No third-party system was scanned. ' +
      'Results describe the scanner on this lab and should not be read as the prevalence of these flaws in real applications.',
    MARGIN, doc.page.height - 150, { width: cw, align: 'justify', lineGap: 1.5 },
  );
}

function bars(doc: Doc, rows: { label: string; value: number | null; shade: string }[]): void {
  const barX = MARGIN + 130;
  const barW = contentWidth(doc) - 190;
  ensureSpace(doc, rows.length * 20 + 10);
  for (const row of rows) {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(row.label, MARGIN, y + 2, { width: 125 });
    doc.rect(barX, y + 1, barW, 10).lineWidth(0.5).strokeColor(RULE_LINE).stroke();
    if (row.value) doc.rect(barX, y + 1, barW * row.value, 10).fillColor(row.shade).fill();
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(pct(row.value), barX + barW + 8, y + 2, { width: 50 });
    doc.y = y + 18;
  }
  doc.moveDown(0.6);
}

function setupTable(doc: Doc, r: EvaluationResult): void {
  const w = contentWidth(doc);
  table(doc, [
    { header: 'Setup', width: 88 },
    { header: 'Found', width: 64 },
    { header: 'In reach', width: 64 },
    { header: 'Findings', width: 66 },
    { header: 'False alarms', width: 58 },
    { header: 'Precision', width: 72 },
    { header: 'Clean app alarms', width: w - 412 },
  ], r.setups.map((s) => [s.name, frac(s.detected, s.planted), frac(s.detectedInReach, s.reachable), String(s.findings), String(s.falsePositives), pct(s.precision), String(s.cleanFalsePositives)]), bold0);
}

function summary(doc: Doc, input: EvaluationInput): void {
  const { dev, holdout } = input;
  heading(doc, '1. Summary');
  const [repo, web, combined] = dev.setups;
  const vis = Object.fromEntries(dev.byVisibility.map((v) => [v.visibility, v]));
  const better = Math.max(repo.detected, web.detected);
  para(doc,
    `On the development set (${dev.apps.length} apps, ${repo.planted} planted flaws), scanning with repository access alone found ${frac(repo.detected, repo.planted)}, ` +
    `browser-only scanning found ${frac(web.detected, web.planted)}, and the two combined found ${frac(combined.detected, combined.planted)}. ` +
    `${vis.repo?.planted ?? 0} flaw(s) left evidence only in the repository and ${vis.web?.planted ?? 0} only in the deployment, so neither setup alone can reach every flaw; ` +
    `combining them ${combined.detected > better ? `adds ${combined.detected - better} flaw(s) over the better single setup` : 'does not add flaws over the better single setup'}. ` +
    `On the held-out set, which was not used to build the scanner, the combined setup found ${frac(holdout.setups[2].detected, holdout.setups[2].planted)}.`);

  for (const [key, label] of SETS) {
    subheading(doc, `Share of planted flaws found: ${label.toLowerCase()}`);
    bars(doc, input[key].setups.map((s) => ({ label: s.name, value: s.recall, shade: SHADE[s.setup] })));
  }
  for (const [key, label] of SETS) {
    subheading(doc, label);
    setupTable(doc, input[key]);
  }

  subheading(doc, 'Answer to the research question');
  bullets(doc, [
    `${repo.detected >= web.detected ? `Repository access was the stronger single setup (${repo.detected} versus ${web.detected} flaws on the development set, ${holdout.setups[0].detected} versus ${holdout.setups[1].detected} on the held-out set).` : `Browser-only scanning found more flaws on the development set (${web.detected} versus ${repo.detected}).`} The repository shows configuration that never reaches the browser: storage and database policies, privileged functions, edge functions and secrets in git history.`,
    `Browser-only scanning is the only way to see what is actually deployed: settings made in hosting or database dashboards, files the host serves, and data that is readable right now. It found ${vis.web ? `${vis.web.web} of ${vis.web.planted}` : 'no'} deployment-only flaw(s) on the development set that the repository could not show.`,
    'Recommendation: scan with repository access first for coverage and precise evidence, then confirm the live deployment with a read-only browser scan.',
  ]);
}

function method(doc: Doc, input: EvaluationInput): void {
  heading(doc, '2. Method');
  para(doc, 'Each lab app is a small project in the style that AI app builders produce, together with a simulated deployment. The repository is created as a real git repository (some secrets exist only in its history). The deployment is a local web server that serves the built site and imitates the Supabase REST and storage API and the Firebase Realtime Database and Firestore REST API.');
  bullets(doc, [
    'Development set: used while building the scanner. It includes two "hard case" apps with realistic flaws in forms the rules were not written for; their misses exposed four gaps.',
    'Held-out set: new apps with fresh variants of those four gap classes, plus other flaws and clean controls. It was written and scored with the unchanged scanner, and that baseline was committed to git before any fix, so it measures whether the fixes generalise.',
    'Ground truth: every planted flaw lists, for each setup, the rule that should report it. A setup without an entry cannot see that flaw by design (for example, a table created in the Supabase dashboard has no trace in the repository).',
    'Matching: a finding counts for a flaw when its rule matches and, where given, a distinguishing word appears in its location or evidence. Several findings may match one flaw; the flaw is counted once.',
    'Found: planted flaws matched by at least one finding of the setup. In reach: the same, counted only over flaws that leave evidence where the setup looks. False alarm: a finding that matches no planted flaw of its app. Precision: the share of findings that match a planted flaw.',
    'The repository scan reads files and git history only; the browser scan sends GET requests only, exactly as against a real target.',
  ]);
  for (const [key, label] of SETS) {
    subheading(doc, `Lab apps: ${label.toLowerCase()}`);
    const w = contentWidth(doc);
    table(doc, [{ header: 'App', width: 80 }, { header: 'Stack', width: 120 }, { header: 'Scenario', width: w - 200 }],
      input[key].apps.map((a) => [`${a.name}${a.clean ? ' (clean)' : ''}`, a.stack, a.story]), bold0);
  }
}

function beforeAfter(doc: Doc, input: EvaluationInput): void {
  if (!input.baseline) return;
  heading(doc, '3. Before and after closing the gaps');
  para(doc, 'The development set exposed four gaps. Each was closed with a general rule change, not one aimed at a single app:');
  bullets(doc, [
    'Keys that bypass row level security under other names: variables named ..._SERVICE_KEY or ..._ADMIN_KEY, and Supabase secret keys in the newer sb_secret_ format. Names that are public by design (Firebase web key, anon and publishable keys) are excluded.',
    'Database policies that let any signed-in user update or delete every row (auth.role() = \'authenticated\', auth.uid() is not null and equivalent forms). Read access for all signed-in users is not reported, since it is often intended.',
    'Lazily loaded code: the browser scan now follows dynamic import() calls, Vite preload lists, Next.js chunk paths and modulepreload links on the same origin.',
    'Firebase rules where "signed in" is the only condition: any write, and reads that cover the whole database (the root, {document=**}).',
  ]);
  const w = contentWidth(doc);
  const rows: string[][] = [];
  for (const [key, label] of SETS) {
    input[key].setups.forEach((s, i) => {
      const b = input.baseline![key].setups[i];
      rows.push([label.replace(' set', ''), s.name, frac(b.detected, b.planted), frac(s.detected, s.planted), `${b.falsePositives} / ${s.falsePositives}`]);
    });
  }
  table(doc, [{ header: 'Set', width: 82 }, { header: 'Setup', width: 100 }, { header: 'Found before', width: 95 }, { header: 'Found after', width: 95 }, { header: 'False alarms before / after', width: w - 372 }], rows, bold0);
  const fixed = (key: 'dev' | 'holdout') => {
    const before = new Set(input.baseline![key].missedInReach.filter((m) => m.setup === 'Combined').map((m) => `${m.app}/${m.id}`));
    return input[key].issues.filter((i) => before.has(`${i.app}/${i.id}`)).map((i) => `${i.app}: ${i.title}`);
  };
  const heldOutFixed = fixed('holdout');
  if (heldOutFixed.length) {
    subheading(doc, 'Held-out flaws missed before and found after');
    bullets(doc, heldOutFixed);
  }
}

function breakdowns(doc: Doc, input: EvaluationInput, n: number): void {
  const w = contentWidth(doc);
  const cols = [{ header: 'Planted', width: 64 }, { header: 'Repository only', width: 92 }, { header: 'Browser only', width: 84 }, { header: 'Combined', width: 75 }];

  heading(doc, `${n}. Results by where the flaw leaves evidence`);
  for (const [key, label] of SETS) {
    subheading(doc, label);
    table(doc, [{ header: 'Evidence in', width: w - 315 }, ...cols],
      input[key].byVisibility.map((v) => [VISIBILITY_LABEL[v.visibility], String(v.planted), String(v.repo), String(v.web), String(v.combined)]), bold0);
  }

  heading(doc, `${n + 1}. Results by category`);
  for (const [key, label] of SETS) {
    subheading(doc, label);
    table(doc, [{ header: 'Category', width: w - 315 }, ...cols],
      input[key].byCategory.map((c) => [c.category, String(c.planted), String(c.repo), String(c.web), String(c.combined)]), bold0);
  }

  heading(doc, `${n + 2}. Results by app`);
  for (const [key, label] of SETS) {
    subheading(doc, label);
    table(doc, [
      { header: 'App', width: 95 },
      { header: 'Planted', width: 64 },
      { header: 'Repo', width: 50 },
      { header: 'Web', width: 50 },
      { header: 'Combined', width: 70 },
      { header: 'False alarms repo / web', width: w - 329 },
    ], input[key].apps.map((a) => [`${a.name}${a.clean ? ' (clean)' : ''}`, String(a.planted), String(a.detected.repo), String(a.detected.web), String(a.detected.combined), `${a.falsePositives.repo} / ${a.falsePositives.web}`]), bold0);
  }
}

function errors(doc: Doc, input: EvaluationInput, n: number): void {
  heading(doc, `${n}. Missed flaws within reach`);
  const missed = SETS.flatMap(([key, label]) => input[key].missedInReach.map((m) => `${label.replace(' set', '')}, ${m.setup}: ${m.app} - ${m.title}`));
  if (!missed.length) {
    para(doc, 'None. Every planted flaw that left evidence where a setup looks was reported by that setup, on both sets.');
  } else {
    para(doc, 'These flaws left evidence where the setup looks, but no finding matched them. They are detection failures of the scanner, not limits of the setup.');
    bullets(doc, missed);
  }

  heading(doc, `${n + 1}. False alarms`);
  const all = SETS.flatMap(([key, label]) => input[key].falsePositives.map((f) => ({ ...f, set: label.replace(' set', '') })));
  if (!all.length) {
    para(doc, 'None.');
    return;
  }
  const w = contentWidth(doc);
  table(doc, [{ header: 'Set', width: 70 }, { header: 'App', width: 70 }, { header: 'Track', width: 46 }, { header: 'Rule', width: 72 }, { header: 'Evidence', width: w - 258 }],
    all.map((f) => [f.set, `${f.app}${f.clean ? ' (clean)' : ''}`, f.track, f.ruleId, f.evidence]), bold0);
  const notes = [...new Set(all.filter((f) => f.note).map((f) => `${f.app}: ${f.note}`))];
  if (all.some((f) => f.ruleId === 'VP-ENV-002' && /MAPS/.test(f.evidence))) {
    notes.push('gardenlog: browser map keys (for example Google Maps) are public by design and restricted by referrer. The name-based rule cannot tell them apart from secrets; this was left unfixed rather than special-cased after seeing the held-out set.');
  }
  if (notes.length) bullets(doc, notes);
}

function validity(doc: Doc, n: number): void {
  heading(doc, `${n}. Threats to validity`);
  bullets(doc, [
    'The lab was written by the same team that wrote the scanner, so the planted flaws resemble what the rules look for. Flaws in unusual forms are likely to be missed more often in real apps.',
    'The held-out set was written after the development set had exposed the gaps, by people who knew those gaps. It uses different names, key formats and code shapes, but it is not independent in the way apps from an outside source would be.',
    'One labelling error was found in the development set while closing the gaps (liftlog\'s root rule letting any signed-in user write) and corrected before the baseline was recorded.',
    'Where a flaw leaves evidence is a property of each scenario. Different scenarios would move flaws between the repository-only and deployment-only groups and change the headline numbers.',
    'The simulated deployment imitates Supabase and Firebase responses; real services can differ in status codes and in what the anon key may read.',
    'The sample is small. The results show which setup can see which kind of flaw; they do not estimate how common each flaw is.',
  ]);
}

function appendix(doc: Doc, input: EvaluationInput): void {
  heading(doc, 'Appendix. Planted flaws and detection');
  const w = contentWidth(doc);
  const mark = (reach: boolean, found: boolean) => (!reach ? '-' : found ? 'found' : 'MISSED');
  for (const [key, label] of SETS) {
    subheading(doc, label);
    table(doc, [{ header: 'App', width: 70 }, { header: 'Flaw', width: w - 308 }, { header: 'Category', width: 70 }, { header: 'Evidence in', width: 68 }, { header: 'Repo', width: 50 }, { header: 'Web', width: 50 }],
      input[key].issues.map((i) => [i.app, i.title, i.category, VISIBILITY_LABEL[i.visibility],
        mark(i.visibility !== 'web', i.detectedBy.repo), mark(i.visibility !== 'repo', i.detectedBy.web)]), bold0);
  }
  para(doc, '"-" means the flaw leaves no evidence where that setup looks.', { size: 8.5, color: MUTED });
}

export async function writeEvaluationPdf(input: EvaluationInput, outPath: string): Promise<void> {
  const stamp = input.dev.generatedAt;
  const id = `VP-EVAL-${stamp.slice(0, 10).replace(/-/g, '')}-${createHash('sha256').update(stamp).digest('hex').slice(0, 4).toUpperCase()}`;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: 'Vibeproof Detection Evaluation', Subject: 'Repository access versus browser-only scanning', Creator: ascii(`${input.dev.tool} ${input.dev.version}`) },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);
  cover(doc, input, id);
  doc.addPage();
  summary(doc, input);
  method(doc, input);
  beforeAfter(doc, input);
  const n = input.baseline ? 4 : 3;
  breakdowns(doc, input, n);
  errors(doc, input, n + 3);
  validity(doc, n + 5);
  appendix(doc, input);
  pageChrome(doc, 'Vibeproof Detection Evaluation', id, 'Research results');
  doc.end();
  await once(stream, 'finish');
}
