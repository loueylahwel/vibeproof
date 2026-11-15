// Renders every Markdown file in docs/ to a formal black-and-white PDF next to it.
//   npm run docs
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeMarkdownPdf } from '../dist/report/markdown-pdf.js';

const dir = path.resolve('docs');
for (const name of (await readdir(dir)).filter((f) => f.endsWith('.md'))) {
  const md = await readFile(path.join(dir, name), 'utf8');
  const version = /\|\s*Version\s*\|\s*([^|]+)\|/.exec(md)?.[1].trim();
  // Optional first-line settings, for example: <!-- lang: fr; label: Document du projet Vibeproof -->
  const meta = Object.fromEntries([.../<!--([^>]*)-->/.exec(md)?.[1].matchAll(/(\w+)\s*:\s*([^;]+)/g) ?? []].map((m) => [m[1], m[2].trim()]));
  const out = path.join(dir, name.replace(/\.md$/, '.pdf').toLowerCase());
  await writeMarkdownPdf(md, out, { label: meta.label ?? 'Vibeproof project document', lang: meta.lang === 'fr' ? 'fr' : 'en', id: version ? `v${version.split(',')[0]}` : undefined });
  console.log(`docs/${path.basename(out)}`);
}
