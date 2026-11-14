import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import { SEVERITY_ORDER, type Finding, type ScanReport, type Severity } from '../types.js';

type Doc = PDFKit.PDFDocument;

// Black and white only: severity is carried by words, weight and grey shades,
// so the report prints and photocopies without losing meaning.
const MARGIN = 56;
const INK = '#000000';
const MUTED = '#555555';
const RULE_LINE = '#bbbbbb';
const ACCENT = '#000000';
const TINT = '#f2f2f2';
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: INK,
  high: INK,
  medium: INK,
  low: INK,
  info: INK,
};
/** Grey shade per severity, darkest for the worst. Used for bars only. */
const SEVERITY_SHADE: Record<Severity, string> = {
  critical: '#000000',
  high: '#404040',
  medium: '#7a7a7a',
  low: '#a8a8a8',
  info: '#cfcfcf',
};

/** The standard PDF fonts only cover Latin-1; keep dynamic text printable ASCII. */
function ascii(value: string): string {
  return value.replace(/[^\x20-\x7E\n]/g, '?');
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.ruleId.localeCompare(b.ruleId),
  );
}

function reportId(report: ScanReport): string {
  const day = report.finishedAt.slice(0, 10).replace(/-/g, '');
  const hash = createHash('sha256').update(report.target + report.finishedAt).digest('hex').slice(0, 6).toUpperCase();
  return `VSC-${day}-${hash}`;
}

function contentWidth(doc: Doc): number {
  return doc.page.width - MARGIN * 2;
}

function ensureSpace(doc: Doc, height: number): void {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function heading(doc: Doc, text: string): void {
  ensureSpace(doc, 60);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(15).fillColor(ACCENT).text(ascii(text), MARGIN, doc.y, { width: contentWidth(doc) });
  const y = doc.y + 3;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentWidth(doc), y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.y = y + 10;
}

function subheading(doc: Doc, text: string): void {
  ensureSpace(doc, 40);
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(ascii(text), MARGIN, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.2);
}

function para(doc: Doc, text: string, opts: { size?: number; color?: string } = {}): void {
  doc.font('Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? INK);
  const h = doc.heightOfString(ascii(text), { width: contentWidth(doc), lineGap: 2 });
  ensureSpace(doc, Math.min(h, 120));
  doc.text(ascii(text), MARGIN, doc.y, { width: contentWidth(doc), lineGap: 2, align: 'justify' });
  doc.moveDown(0.5);
}

function bullets(doc: Doc, items: string[]): void {
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  for (const item of items) {
    const h = doc.heightOfString(ascii(item), { width: contentWidth(doc) - 14, lineGap: 2 });
    ensureSpace(doc, h + 4);
    const y = doc.y;
    doc.text('-', MARGIN + 2, y);
    doc.text(ascii(item), MARGIN + 14, y, { width: contentWidth(doc) - 14, lineGap: 2 });
    doc.moveDown(0.25);
  }
  doc.moveDown(0.3);
}

function codeBox(doc: Doc, text: string): void {
  const width = contentWidth(doc);
  doc.font('Courier').fontSize(8.5);
  const h = doc.heightOfString(ascii(text), { width: width - 16 }) + 12;
  ensureSpace(doc, h + 6);
  const y = doc.y;
  doc.rect(MARGIN, y, width, h).fillColor(TINT).fill();
  doc.rect(MARGIN, y, 2, h).fillColor(ACCENT).fill();
  doc.fillColor(INK).text(ascii(text), MARGIN + 10, y + 6, { width: width - 16 });
  doc.y = y + h + 8;
}

interface Column {
  header: string;
  width: number;
}
interface CellStyle {
  color?: string;
  bold?: boolean;
}

function table(doc: Doc, columns: Column[], rows: string[][], style?: (row: number, col: number) => CellStyle): void {
  const pad = 5;
  const fontSize = 9;
  const drawHeader = () => {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(fontSize);
    const h = Math.max(...columns.map((c) => doc.heightOfString(c.header, { width: c.width - pad * 2 }))) + pad * 2;
    const total = columns.reduce((s, c) => s + c.width, 0);
    doc.moveTo(MARGIN, y).lineTo(MARGIN + total, y).lineWidth(1.2).strokeColor(INK).stroke();
    let x = MARGIN;
    for (const c of columns) {
      doc.fillColor(INK).text(c.header.toUpperCase(), x + pad, y + pad, { width: c.width - pad * 2, characterSpacing: 0.6 });
      x += c.width;
    }
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + total, y + h).lineWidth(0.6).strokeColor(INK).stroke();
    doc.y = y + h;
  };

  ensureSpace(doc, 50);
  drawHeader();
  rows.forEach((row, r) => {
    const heights = row.map((cell, c) => {
      doc.font(style?.(r, c).bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      return doc.heightOfString(ascii(cell), { width: columns[c].width - pad * 2 });
    });
    const h = Math.max(...heights) + pad * 2;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    const total = columns.reduce((s, c) => s + c.width, 0);
    if (r % 2 === 1) doc.rect(MARGIN, y, total, h).fillColor('#f7f7f7').fill();
    let x = MARGIN;
    row.forEach((cell, c) => {
      const s = style?.(r, c) ?? {};
      doc.font(s.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(s.color ?? INK)
        .text(ascii(cell), x + pad, y + pad, { width: columns[c].width - pad * 2 });
      x += columns[c].width;
    });
    doc.moveTo(MARGIN, y + h).lineTo(MARGIN + total, y + h).lineWidth(0.5).strokeColor(RULE_LINE).stroke();
    doc.y = y + h;
  });
  doc.x = MARGIN;
  doc.moveDown(0.8);
}

function severityBadge(doc: Doc, severity: Severity, x: number, y: number): void {
  // Critical and high are solid black; lower severities are outlined.
  const label = severity.toUpperCase();
  doc.font('Helvetica-Bold').fontSize(8);
  const w = doc.widthOfString(label, { characterSpacing: 0.8 }) + 14;
  const solid = severity === 'critical' || severity === 'high';
  if (solid) doc.rect(x, y, w, 14).fillColor(INK).fill();
  else doc.rect(x + 0.4, y + 0.4, w - 0.8, 13.2).lineWidth(0.8).strokeColor(INK).stroke();
  doc.fillColor(solid ? '#ffffff' : INK).text(label, x + 7, y + 3.5, { lineBreak: false, characterSpacing: 0.8 });
}

function overallRating(findings: Finding[]): Severity | 'none' {
  for (const s of SEVERITY_ORDER) if (findings.some((f) => f.severity === s)) return s;
  return 'none';
}

function cover(doc: Doc, report: ScanReport, id: string): void {
  const cw = contentWidth(doc);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('CONFIDENTIAL', MARGIN, 72, { characterSpacing: 2.5, lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(id, MARGIN, 72, { width: cw, align: 'right', lineBreak: false });
  doc.moveTo(MARGIN, 90).lineTo(MARGIN + cw, 90).lineWidth(2.5).strokeColor(INK).stroke();
  doc.font('Helvetica-Bold').fontSize(30).fillColor(INK).text('Security Assessment', MARGIN, 128, { width: cw });
  doc.text('Report', MARGIN, doc.y, { width: cw });
  doc.font('Helvetica').fontSize(12.5).fillColor(MUTED)
    .text(report.track === 'repo' ? 'Source repository analysis (white-box)' : 'Deployed application analysis (black-box, read-only)', MARGIN, doc.y + 12);
  doc.moveTo(MARGIN, doc.y + 22).lineTo(MARGIN + cw, doc.y + 22).lineWidth(0.6).strokeColor(INK).stroke();

  doc.y += 50;
  const counts = SEVERITY_ORDER.map((s) => report.findings.filter((f) => f.severity === s).length);
  table(doc, [{ header: 'Assessment details', width: 140 }, { header: '', width: contentWidth(doc) - 140 }], [
    ['Target', report.target],
    ['Assessment type', report.track === 'repo' ? 'Static repository scan' : 'Live web application scan'],
    ['Report ID', id],
    ['Scan started', report.startedAt],
    ['Scan finished', report.finishedAt],
    ['Tool', `${report.tool} ${report.version}`],
    ['Findings', `${report.findings.length} total: ${counts[0]} critical, ${counts[1]} high, ${counts[2]} medium, ${counts[3]} low, ${counts[4]} informational`],
  ], (_r, c) => (c === 0 ? { bold: true } : {}));

  const rating = overallRating(report.findings);
  doc.moveDown(1);
  const ry = doc.y;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('OVERALL RISK RATING', MARGIN, ry + 3, { characterSpacing: 1.2, lineBreak: false });
  if (rating === 'none') {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text('NO FINDINGS', MARGIN + 150, ry + 3, { lineBreak: false });
  } else {
    severityBadge(doc, rating, MARGIN + 150, ry);
  }

  doc.moveTo(MARGIN, doc.page.height - 162).lineTo(MARGIN + cw, doc.page.height - 162).lineWidth(0.6).strokeColor(INK).stroke();
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'This report was produced by an automated scanner as part of an academic security project. It contains security-sensitive ' +
      'information about the target and must only be shared with the target owner and the project supervisors. Secret values are ' +
      'redacted throughout. Automated results can include false positives and do not prove the absence of other vulnerabilities.',
    MARGIN, doc.page.height - 150, { width: contentWidth(doc), align: 'justify', lineGap: 1.5 },
  );
}

function executiveSummary(doc: Doc, report: ScanReport, sorted: Finding[]): void {
  heading(doc, '1. Executive summary');
  const rating = overallRating(report.findings);
  const counts = SEVERITY_ORDER.map((s) => ({ s, n: report.findings.filter((f) => f.severity === s).length }));
  const summary = report.findings.length === 0
    ? `The automated assessment of ${report.target} did not identify any issues covered by the rule set. See section 6 for the limits of this result.`
    : `The automated assessment of ${report.target} identified ${report.findings.length} finding(s). The overall risk rating is ${rating.toUpperCase()}, ` +
      `set by the most severe finding. ${counts.filter((c) => c.n).map((c) => `${c.n} ${c.s}`).join(', ')}.`;
  para(doc, summary);

  // Severity distribution with bars
  const max = Math.max(1, ...counts.map((c) => c.n));
  const barX = MARGIN + 130;
  const barW = contentWidth(doc) - 170;
  ensureSpace(doc, 110);
  for (const { s, n } of counts) {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(SEVERITY_COLOR[s]).text(s.toUpperCase(), MARGIN, y + 2, { width: 80 });
    doc.font('Helvetica').fillColor(INK).text(String(n), MARGIN + 90, y + 2, { width: 30, align: 'right' });
    doc.rect(barX, y + 1, barW, 10).lineWidth(0.5).strokeColor(RULE_LINE).stroke();
    if (n) doc.rect(barX, y + 1, (barW * n) / max, 10).fillColor(SEVERITY_SHADE[s]).fill();
    doc.y = y + 18;
  }
  doc.moveDown(0.6);

  const priorities = sortFindings(sorted).filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (priorities.length) {
    subheading(doc, 'Priority actions');
    const unique = [...new Map(priorities.map((f) => [f.ruleId, f])).values()].slice(0, 5);
    bullets(doc, unique.map((f) => `${f.title} (${f.ruleId}): ${f.remediation}`));
  }
}

function scope(doc: Doc, report: ScanReport): void {
  heading(doc, '2. Scope and rules of engagement');
  if (report.track === 'repo') {
    para(doc, `Target: the source repository at ${report.target}. The analysis was static: files and git history were read, and no code from the target was executed.`);
  } else {
    para(doc, `Target: the deployed application at ${report.target}. The operator attested before the scan that they own the target or hold written permission from its owner to test it.`);
    bullets(doc, [
      'All requests used HTTP GET. The scanner has no code path that sends POST, PUT, PATCH or DELETE.',
      'Only scripts served from the target origin were downloaded. Third-party scripts were not fetched.',
      'Database probes sent one request per table with limit=1, using only the public anon key shipped to every visitor. Row values were not stored; only column names are reported.',
      'Keys found in the target were decoded to read their role claim. A service_role key, if found, was never used.',
      'No authentication, brute force, fuzzing or load generation was performed.',
    ]);
  }
}

function overview(doc: Doc, sorted: Finding[]): void {
  heading(doc, '3. Findings overview');
  if (!sorted.length) {
    para(doc, 'No findings.');
    return;
  }
  const w = contentWidth(doc);
  table(doc, [
    { header: '#', width: 26 },
    { header: 'Severity', width: 62 },
    { header: 'Finding', width: 180 },
    { header: 'Location', width: w - 268 },
  ], sorted.map((f, i) => [String(i + 1), f.severity.toUpperCase(), `${f.title} (${f.ruleId})`, f.location]),
  (r, c) => (c === 1 ? { color: SEVERITY_COLOR[sorted[r].severity], bold: true } : {}));
}

function details(doc: Doc, sorted: Finding[]): void {
  heading(doc, '4. Detailed findings');
  sorted.forEach((f, i) => {
    ensureSpace(doc, 190);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK)
      .text(ascii(`4.${i + 1}  ${f.title}`), MARGIN, y, { width: contentWidth(doc) - 80 });
    severityBadge(doc, f.severity, MARGIN + contentWidth(doc) - 70, y);
    doc.y = Math.max(doc.y, y + 16) + 4;
    doc.x = MARGIN;

    table(doc, [{ header: 'Attribute', width: 110 }, { header: 'Value', width: contentWidth(doc) - 110 }], [
      ['Rule', f.ruleId],
      ['Severity', f.severity.toUpperCase()],
      ['Location', f.location],
      ['Classification', `${f.owasp}; ${f.cwe}`],
    ], (r, c) => (c === 0 ? { bold: true } : r === 1 ? { color: SEVERITY_COLOR[f.severity], bold: true } : {}));

    subheading(doc, 'Description');
    para(doc, f.description);
    subheading(doc, 'Evidence (redacted)');
    codeBox(doc, f.evidence);
    subheading(doc, 'Recommendation');
    para(doc, f.remediation);
    if (i < sorted.length - 1) {
      const ly = doc.y + 4;
      doc.moveTo(MARGIN, ly).lineTo(MARGIN + contentWidth(doc), ly).lineWidth(0.5).dash(3, { space: 3 }).strokeColor(RULE_LINE).stroke().undash();
      doc.y = ly + 8;
    }
  });
}

function methodology(doc: Doc, report: ScanReport): void {
  heading(doc, '5. Methodology');
  if (report.track === 'repo') {
    bullets(doc, [
      'Secret detection: pattern matching for private keys, cloud, payment, source-hosting and AI provider keys, and credential assignments, over every text file and every added line in git history.',
      'Supabase keys: every JWT found is decoded; a role claim of service_role is reported as critical.',
      'Environment hygiene: .env files tracked by git, and secret-named variables carrying a public build prefix (NEXT_PUBLIC_, VITE_, REACT_APP_, NUXT_PUBLIC_, EXPO_PUBLIC_, PUBLIC_).',
      'Database access rules: static parsing of SQL migrations for public tables without row level security and policies whose condition is "true".',
      'Client exposure: references to the service_role key outside server-only paths.',
      'Dependencies: lockfile presence and, when enabled, npm audit for production dependencies.',
    ]);
  } else {
    bullets(doc, [
      'Response headers of the target page: CSP, HSTS, clickjacking protection, MIME sniffing protection.',
      'Same-origin JavaScript bundles and the HTML page: secret detection and JWT role decoding.',
      'Public source maps referenced by the bundles.',
      'Supabase: discovery of the project URL, anon key and table names in shipped code, then one read-only request per table.',
      'Commonly exposed files: /.env and /.git/HEAD.',
    ]);
  }
  para(doc, 'Severity follows the rule catalogue in Appendix B and reflects likely impact if the issue is exploited, not a full risk assessment of the business context.', { color: MUTED, size: 9 });
}

function limitations(doc: Doc, report: ScanReport): void {
  heading(doc, '6. Limitations');
  const common = [
    'Pattern-based detection can miss secrets in unusual formats and can flag values that are not real secrets. Each finding should be confirmed by the owner.',
    'The absence of a finding does not prove the absence of a vulnerability. Business logic, authentication flows and server code were not tested.',
  ];
  bullets(doc, report.track === 'repo'
    ? [...common, 'Database rules changed in the Supabase dashboard, or created by dynamic SQL, are not visible in the repository.', 'Values set only in the hosting provider (for example Vercel or Netlify environment variables) are not visible here; a web scan of the deployment covers them.']
    : [...common, 'Only tables named in shipped code were probed. Other tables in the same project may also be exposed.', 'Only same-origin scripts are scanned; code loaded later by dynamic import or from other origins may be missed.']);
}

function appendix(doc: Doc, report: ScanReport): void {
  heading(doc, 'Appendix A. Scan log');
  bullets(doc, report.notes.length ? report.notes : ['No notes recorded.']);

  heading(doc, 'Appendix B. Severity definitions');
  table(doc, [{ header: 'Severity', width: 80 }, { header: 'Meaning', width: contentWidth(doc) - 80 }], [
    ['CRITICAL', 'Direct, unauthenticated compromise of data or infrastructure is likely (for example a leaked service_role key or a write-anyone policy). Fix immediately.'],
    ['HIGH', 'Sensitive data or privileged access is exposed, or a single step away from exposure. Fix before the next release.'],
    ['MEDIUM', 'Weakens defences or leaks information that helps an attacker. Plan a fix.'],
    ['LOW', 'Hardening gap with limited direct impact.'],
    ['INFO', 'Observation for context; no action required.'],
  ], (r, c) => (c === 0 ? { bold: true, color: SEVERITY_COLOR[SEVERITY_ORDER[r]] } : {}));
}

function headersAndFooters(doc: Doc, report: ScanReport, id: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const w = contentWidth(doc);
    if (i > range.start) {
      doc.font('Helvetica').fontSize(8).fillColor(MUTED)
        .text(ascii(`Security Assessment Report  |  ${report.target}`), MARGIN, 28, { width: w - 120, lineBreak: false, ellipsis: true });
      doc.text(id, MARGIN + w - 120, 28, { width: 120, align: 'right', lineBreak: false });
      doc.moveTo(MARGIN, 42).lineTo(MARGIN + w, 42).lineWidth(0.5).strokeColor(RULE_LINE).stroke();
    }
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Confidential  |  Page ${i - range.start + 1} of ${range.count}`, MARGIN, doc.page.height - 36, { width: w, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

export async function writePdf(report: ScanReport, outPath: string): Promise<void> {
  const id = reportId(report);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: `Security Assessment Report - ${ascii(report.target)}`, Subject: 'Automated security assessment', Creator: `${report.tool} ${report.version}` },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);

  const sorted = sortFindings(report.findings);
  cover(doc, report, id);
  doc.addPage();
  executiveSummary(doc, report, sorted);
  scope(doc, report);
  overview(doc, sorted);
  if (sorted.length) details(doc, sorted);
  methodology(doc, report);
  limitations(doc, report);
  appendix(doc, report);
  headersAndFooters(doc, report, id);

  doc.end();
  await once(stream, 'finish');
}
