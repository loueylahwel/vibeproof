import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseMarkdown } from '../dist/report/markdown-pdf.js';

test('markdown subset parses into title, headings, bullets and tables', () => {
  const blocks = parseMarkdown('# T\n\nIntro **bold**.\n\n## A\n\n- one\n- `two`\n\n| X | Y |\n|---|---|\n| 1 | |\n');
  assert.deepEqual(blocks.map((b) => b.kind), ['title', 'para', 'heading', 'bullets', 'table']);
  assert.equal(blocks[1].text, 'Intro bold.');
  assert.deepEqual(blocks[3].items, ['one', 'two']);
  assert.deepEqual(blocks[4], { kind: 'table', header: ['X', 'Y'], rows: [['1', '']] });
});

test('rules of engagement document has every section and a sign-off table', async () => {
  const blocks = parseMarkdown(await readFile('docs/RULES-OF-ENGAGEMENT.md', 'utf8'));
  const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text);
  for (const h of ['Purpose', 'Scope', 'Permitted activities', 'Prohibited activities', 'Safeguards built into the tool', 'Data handling', 'When a real weakness is found', 'Sign-off']) {
    assert.ok(headings.some((x) => x.endsWith(h)), `missing section: ${h}`);
  }
  assert.equal(blocks.at(-1).kind, 'table');
});
