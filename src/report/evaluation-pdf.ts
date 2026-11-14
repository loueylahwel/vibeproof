import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import {
  ascii, bullets, contentWidth, ensureSpace, heading, INK, MARGIN, MUTED, pageChrome, para, RULE_LINE, subheading, table, type Doc,
} from './pdf.js';

/** Shape produced by lab/evaluate.mjs. */
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

const SHADE = { repo: '#7a7a7a', web: '#b0b0b0', combined: '#000000' } as const;
const VISIBILITY_LABEL: Record<string, string> = { repo: 'Repository only', web: 'Deployment only', both: 'Both' };

const pct = (x: number | null) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);
const frac = (n: number, d: number) => `${n}/${d} (${pct(d ? n / d : null)})`;

function cover(doc: Doc, r: EvaluationResult, id: string): void {
  const cw = contentWidth(doc);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('RESEARCH RESULTS', MARGIN, 72, { characterSpacing: 2.5, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(id, MARGIN, 72, { width: cw, align: 'right', lineBreak: false });
  doc.moveTo(MARGIN, 90).lineTo(MARGIN + cw, 90).lineWidth(2.5).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(30).fillColor(INK).text('Detection Evaluation', MARGIN, 128, { width: cw });
  doc.font('Helvetica').fontSize(12.5).fillColor(MUTED)
    .text('Repository access versus browser-only scanning of vibe-coded web apps', MARGIN, doc.y + 12, { width: cw });
  doc.moveTo(MARGIN, doc.y + 22).lineTo(MARGIN + cw, doc.y + 22).lineWidth(0.6).strokeColor(INK).stroke();
  doc.y += 50;

  const vulnerable = r.apps.filter((a) => !a.clean).length;
  table(doc, [{ header: 'Evaluation details', width: 150 }, { header: '', width: cw - 150 }], [
    ['Lab apps', `${r.apps.length} (${vulnerable} with planted flaws, ${r.apps.length - vulnerable} clean controls)`],
    ['Planted flaws', String(r.setups[0].planted)],
    ['Setups compared', r.setups.map((s) => s.name).join(', ')],
    ['Tool', `${r.tool} ${r.version}`],
    ['Generated', r.generatedAt],
    ['Report ID', id],
  ], (_r, c) => (c === 0 ? { bold: true } : {}));

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

function summary(doc: Doc, r: EvaluationResult): void {
  heading(doc, '1. Summary');
  const [repo, web, combined] = r.setups;
  const vis = Object.fromEntries(r.byVisibility.map((v) => [v.visibility, v]));
  const repoOnly = vis.repo?.planted ?? 0;
  const webOnly = vis.web?.planted ?? 0;
  para(doc,
    `On ${r.apps.length} lab apps with ${repo.planted} planted flaws, scanning with repository access alone found ${frac(repo.detected, repo.planted)}, ` +
    `browser-only scanning found ${frac(web.detected, web.planted)}, and the two combined found ${frac(combined.detected, combined.planted)}. ` +
    `${repoOnly} flaw(s) left evidence only in the repository and ${webOnly} only in the deployment, so neither setup alone can reach every flaw; ` +
    `combining them ${combined.detected > Math.max(repo.detected, web.detected) ? `adds ${combined.detected - Math.max(repo.detected, web.detected)} flaw(s) over the better single setup` : 'does not add flaws over the better single setup on this lab'}.`);

  subheading(doc, 'Share of planted flaws found');
  bars(doc, r.setups.map((s) => ({ label: s.name, value: s.recall, shade: SHADE[s.setup] })));

  const w = contentWidth(doc);
  table(doc, [
    { header: 'Setup', width: 88 },
    { header: 'Found', width: 64 },
    { header: 'In reach', width: 64 },
    { header: 'Findings', width: 66 },
    { header: 'False alarms', width: 58 },
    { header: 'Precision', width: 72 },
    { header: 'Clean app alarms', width: w - 412 },
  ], r.setups.map((s) => [s.name, frac(s.detected, s.planted), frac(s.detectedInReach, s.reachable), String(s.findings), String(s.falsePositives), pct(s.precision), String(s.cleanFalsePositives)]),
  (_row, c) => (c === 0 ? { bold: true } : {}));

  subheading(doc, 'Answer to the research question');
  bullets(doc, [
    `${repo.detected >= web.detected ? `Repository access was the stronger single setup on this lab (${repo.detected} versus ${web.detected} flaws).` : `Browser-only scanning found more flaws on this lab (${web.detected} versus ${repo.detected}).`} The repository shows configuration that never reaches the browser: storage and database policies, privileged functions, edge functions and secrets in git history.`,
    `Browser-only scanning is the only way to see what is actually deployed: settings made in hosting or database dashboards, files the host serves, and data that is readable right now. It found ${vis.web ? `${vis.web.web} of ${vis.web.planted}` : 'no'} deployment-only flaw(s) that the repository could not show.`,
    'Recommendation: scan with repository access first for coverage and precise evidence, then confirm the live deployment with a read-only browser scan.',
  ]);
}

function method(doc: Doc, r: EvaluationResult): void {
  heading(doc, '2. Method');
  para(doc, 'Each lab app is a small project in the style that AI app builders produce, together with a simulated deployment. The repository is created as a real git repository (some secrets exist only in its history). The deployment is a local web server that serves the built site and imitates the Supabase REST and storage API and the Firebase Realtime Database and Firestore REST API.');
  bullets(doc, [
    'Ground truth: every planted flaw lists, for each setup, the rule that should report it. A setup without an entry cannot see that flaw by design (for example, a table created in the Supabase dashboard has no trace in the repository).',
    'Matching: a finding counts for a flaw when its rule matches and, where given, a distinguishing word appears in its location or evidence. Several findings may match one flaw; the flaw is counted once.',
    'Flaws found: planted flaws matched by at least one finding of the setup. Found within reach: the same, counted only over flaws that leave evidence where the setup looks.',
    'False alarm: a finding that matches no planted flaw of its app. Precision: the share of findings that match a planted flaw.',
    'Clean controls: three apps built correctly. Any finding on them is a false alarm.',
    'The repository scan reads files and git history only; the browser scan sends GET requests only, exactly as against a real target.',
  ]);
  subheading(doc, 'Lab apps');
  const w = contentWidth(doc);
  table(doc, [{ header: 'App', width: 80 }, { header: 'Stack', width: 120 }, { header: 'Scenario', width: w - 200 }],
    r.apps.map((a) => [`${a.name}${a.clean ? ' (clean)' : ''}`, a.stack, a.story]), (_r, c) => (c === 0 ? { bold: true } : {}));
}

function breakdowns(doc: Doc, r: EvaluationResult): void {
  const w = contentWidth(doc);
  const cols = [{ header: 'Planted', width: 64 }, { header: 'Repository only', width: 92 }, { header: 'Browser only', width: 84 }, { header: 'Combined', width: 75 }];

  heading(doc, '3. Results by where the flaw leaves evidence');
  table(doc, [{ header: 'Evidence in', width: w - 315 }, ...cols],
    r.byVisibility.map((v) => [VISIBILITY_LABEL[v.visibility], String(v.planted), String(v.repo), String(v.web), String(v.combined)]),
    (_r, c) => (c === 0 ? { bold: true } : {}));

  heading(doc, '4. Results by category');
  table(doc, [{ header: 'Category', width: w - 315 }, ...cols],
    r.byCategory.map((c) => [c.category, String(c.planted), String(c.repo), String(c.web), String(c.combined)]),
    (_r, c) => (c === 0 ? { bold: true } : {}));

  heading(doc, '5. Results by app');
  table(doc, [
    { header: 'App', width: 95 },
    { header: 'Planted', width: 64 },
    { header: 'Repo', width: 50 },
    { header: 'Web', width: 50 },
    { header: 'Combined', width: 70 },
    { header: 'False alarms repo / web', width: w - 329 },
  ], r.apps.map((a) => [`${a.name}${a.clean ? ' (clean)' : ''}`, String(a.planted), String(a.detected.repo), String(a.detected.web), String(a.detected.combined), `${a.falsePositives.repo} / ${a.falsePositives.web}`]),
  (_r, c) => (c === 0 ? { bold: true } : {}));
}

function errors(doc: Doc, r: EvaluationResult): void {
  heading(doc, '6. Missed flaws within reach');
  if (!r.missedInReach.length) {
    para(doc, 'None. Every planted flaw that left evidence where a setup looks was reported by that setup.');
  } else {
    para(doc, 'These flaws left evidence where the setup looks, but no finding matched them. They are detection failures of the scanner, not limits of the setup.');
    bullets(doc, r.missedInReach.map((m) => `${m.setup}: ${m.app} - ${m.title}`));
  }

  heading(doc, '7. False alarms');
  if (!r.falsePositives.length) {
    para(doc, 'None.');
    return;
  }
  const w = contentWidth(doc);
  table(doc, [{ header: 'App', width: 75 }, { header: 'Track', width: 50 }, { header: 'Rule', width: 72 }, { header: 'Evidence', width: w - 197 }],
    r.falsePositives.map((f) => [`${f.app}${f.clean ? ' (clean)' : ''}`, f.track, f.ruleId, f.evidence]),
    (_r, c) => (c === 0 ? { bold: true } : {}));
  const notes = [...new Set(r.falsePositives.filter((f) => f.note).map((f) => `${f.app}: ${f.note}`))];
  if (notes.length) bullets(doc, notes);
}

function validity(doc: Doc): void {
  heading(doc, '8. Threats to validity');
  bullets(doc, [
    'The lab was written by the same team that wrote the scanner, so the planted flaws resemble what the rules look for. Flaws in unusual forms are likely to be missed more often in real apps.',
    'Where a flaw leaves evidence is a property of each scenario. Different scenarios would move flaws between the repository-only and deployment-only groups and change the headline numbers.',
    'The simulated deployment imitates Supabase and Firebase responses; real services can differ in status codes and in what the anon key may read.',
    'Ten apps is a small sample. The results show which setup can see which kind of flaw; they do not estimate how common each flaw is.',
  ]);
}

function appendix(doc: Doc, r: EvaluationResult): void {
  heading(doc, 'Appendix. Planted flaws and detection');
  const w = contentWidth(doc);
  const mark = (reach: boolean, found: boolean) => (!reach ? '-' : found ? 'found' : 'MISSED');
  table(doc, [{ header: 'App', width: 70 }, { header: 'Flaw', width: w - 308 }, { header: 'Category', width: 70 }, { header: 'Evidence in', width: 68 }, { header: 'Repo', width: 50 }, { header: 'Web', width: 50 }],
    r.issues.map((i) => [i.app, i.title, i.category, VISIBILITY_LABEL[i.visibility],
      mark(i.visibility !== 'web', i.detectedBy.repo), mark(i.visibility !== 'repo', i.detectedBy.web)]),
    (_r, c) => (c === 0 ? { bold: true } : {}));
  para(doc, '"-" means the flaw leaves no evidence where that setup looks.', { size: 8.5, color: MUTED });
}

export async function writeEvaluationPdf(r: EvaluationResult, outPath: string): Promise<void> {
  const id = `VP-EVAL-${r.generatedAt.slice(0, 10).replace(/-/g, '')}-${createHash('sha256').update(r.generatedAt).digest('hex').slice(0, 4).toUpperCase()}`;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: 'Vibeproof Detection Evaluation', Subject: 'Repository access versus browser-only scanning', Creator: ascii(`${r.tool} ${r.version}`) },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);
  cover(doc, r, id);
  doc.addPage();
  summary(doc, r);
  method(doc, r);
  breakdowns(doc, r);
  errors(doc, r);
  validity(doc);
  appendix(doc, r);
  pageChrome(doc, 'Vibeproof Detection Evaluation', id, 'Research results');
  doc.end();
  await once(stream, 'finish');
}
