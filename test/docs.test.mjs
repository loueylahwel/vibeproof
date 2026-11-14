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

test('project report numbers match the committed evaluation results', async () => {
  const results = JSON.parse(await readFile('evaluation/results.json', 'utf8'));
  const baseline = JSON.parse(await readFile('evaluation/baseline.json', 'utf8'));
  const blocks = parseMarkdown(await readFile('docs/PROJECT-REPORT.md', 'utf8'));
  const tables = blocks.filter((b) => b.kind === 'table');
  const detection = tables.find((t) => t.header.join() === 'Set,Setup,Found,Within reach,False alarms,Precision');
  const beforeAfter = tables.find((t) => t.header.join() === 'Set,Setup,Found before,Found after');
  assert.ok(detection && beforeAfter, 'results tables present');
  for (const [key, label] of [['dev', 'Development'], ['holdout', 'Held-out']]) {
    results[key].setups.forEach((s, i) => {
      const row = detection.rows.find((r) => r[0] === label && r[1] === s.name);
      assert.ok(row[2].startsWith(`${s.detected}/${s.planted} `), `${label} ${s.name} found`);
      assert.equal(row[3], `${s.detectedInReach}/${s.reachable}`, `${label} ${s.name} within reach`);
      assert.equal(row[4], String(s.falsePositives), `${label} ${s.name} false alarms`);
      assert.equal(row[5], `${Math.round(s.precision * 100)}%`, `${label} ${s.name} precision`);
      const ba = beforeAfter.rows.find((r) => r[0] === label && r[1] === s.name);
      const b = baseline[key].setups[i];
      assert.equal(ba[2], `${b.detected}/${b.planted}`, `${label} ${s.name} before`);
      assert.equal(ba[3], `${s.detected}/${s.planted}`, `${label} ${s.name} after`);
    });
  }
});
