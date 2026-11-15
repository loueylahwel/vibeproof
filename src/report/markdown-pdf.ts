import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import PDFDocument from 'pdfkit';
import { bullets, contentWidth, ensureSpace, heading, INK, MARGIN, MUTED, pageChrome, para, subheading, table, type Doc } from './pdf.js';

/**
 * Renders a small subset of Markdown (# title, ## headings, paragraphs,
 * "- " bullets and pipe tables) in the same formal black-and-white style as
 * the scan reports. Used for project documents such as the rules of engagement.
 */

type Block =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim();
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => plain(c));

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('<!--')) continue;
    if (line.startsWith('# ')) blocks.push({ kind: 'title', text: plain(line.slice(2)) });
    else if (line.startsWith('### ')) blocks.push({ kind: 'subheading', text: plain(line.slice(4)) });
    else if (line.startsWith('## ')) blocks.push({ kind: 'heading', text: plain(line.slice(3)) });
    else if (/^\s*- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*- /.test(lines[i])) items.push(plain(lines[i++].replace(/^\s*- /, '')));
      i--;
      blocks.push({ kind: 'bullets', items });
    } else if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      i--;
      blocks.push({ kind: 'table', header: rows[0] ?? [], rows: rows.slice(1) });
    } else {
      const text: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^(#|\s*- |\s*\|)/.test(lines[i])) text.push(lines[i++].trim());
      i--;
      blocks.push({ kind: 'para', text: plain(text.join(' ')) });
    }
  }
  return blocks;
}

function widths(doc: Doc, n: number, header: string[] = []): number[] {
  const w = contentWidth(doc);
  if (n === 2) return [140, w - 140];
  if (n === 4 && header[0] === 'Role') return [100, 150, 140, w - 390]; // sign-off table
  // First column holds names; the rest share the remaining width.
  const first = Math.round(w * (n >= 5 ? 0.24 : 0.3));
  return [first, ...Array.from({ length: n - 1 }, () => (w - first) / (n - 1))];
}

/** Empty cells (for example signature lines) get room to write in. */
const fillEmpty = (rows: string[][]) => rows.map((r) => r.map((c) => c || '\n'));

/** Height the table helper will use, measured with the same fonts and padding. */
function tableHeight(doc: Doc, t: { header: string[]; rows: string[][] }): number {
  const w = widths(doc, t.header.length, t.header);
  const pad = 10;
  doc.font('Helvetica-Bold').fontSize(9);
  let h = Math.max(...t.header.map((c, i) => doc.heightOfString(c.toUpperCase(), { width: w[i] - pad, characterSpacing: 0.6 }))) + pad;
  for (const row of fillEmpty(t.rows)) {
    h += Math.max(...row.map((c, i) => {
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      return doc.heightOfString(c, { width: w[i] - pad });
    })) + pad;
  }
  return h + 12;
}

export async function writeMarkdownPdf(markdown: string, outPath: string, opts: { label?: string; id?: string; lang?: 'en' | 'fr' } = {}): Promise<void> {
  const blocks = parseMarkdown(markdown);
  const title = blocks.find((b) => b.kind === 'title')?.text ?? 'Document';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 64, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: title, Creator: 'vibeproof' },
  });
  const stream = createWriteStream(outPath);
  doc.pipe(stream);
  const cw = contentWidth(doc);

  let afterTitle = false;
  for (const [index, b] of blocks.entries()) {
    if (b.kind === 'title') {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text((opts.label ?? 'Project document').toUpperCase(), MARGIN, 64, { characterSpacing: 2.5, lineBreak: false });
      if (opts.id) doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(opts.id, MARGIN, 64, { width: cw, align: 'right', lineBreak: false });
      doc.moveTo(MARGIN, 80).lineTo(MARGIN + cw, 80).lineWidth(2.5).strokeColor(INK).stroke();
      doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(b.text, MARGIN, 96, { width: cw });
      afterTitle = true;
      continue;
    }
    if (afterTitle && b.kind === 'para') {
      doc.moveDown(0.3);
      para(doc, b.text, { color: MUTED, size: 11 });
      afterTitle = false;
      continue;
    }
    afterTitle = false;
    if (b.kind === 'subheading') subheading(doc, b.text);
    else if (b.kind === 'heading') {
      // Keep a heading together with a short table that follows it.
      const next = blocks[index + 1];
      if (next?.kind === 'table' && next.rows.length <= 8) ensureSpace(doc, 60 + tableHeight(doc, next));
      heading(doc, b.text);
    }
    else if (b.kind === 'para') para(doc, b.text);
    else if (b.kind === 'bullets') bullets(doc, b.items);
    else if (b.kind === 'table') {
      const w = widths(doc, b.header.length, b.header);
      const rows = fillEmpty(b.rows);
      // Keep short tables (such as the sign-off block) on one page.
      if (rows.length <= 8) ensureSpace(doc, tableHeight(doc, b));
      table(doc, b.header.map((h, i) => ({ header: h, width: w[i] })), rows, (_r, c) => (c === 0 ? { bold: true } : {}));
    }
  }

  pageChrome(doc, title, opts.id ?? '', opts.label ?? 'Project document', opts.lang === 'fr' ? ['Page', 'sur'] : ['Page', 'of']);
  doc.end();
  await once(stream, 'finish');
}
