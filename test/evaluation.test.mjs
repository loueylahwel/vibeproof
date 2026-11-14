import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES } from '../dist/rules.js';
import { APPS } from '../lab/catalog.mjs';
import { HOLDOUT } from '../lab/holdout.mjs';
import { runEvaluation } from '../lab/evaluate.mjs';

test('ground truth is consistent', () => {
  const names = [...APPS, ...HOLDOUT].map((a) => a.name);
  assert.equal(new Set(names).size, names.length, 'app names are unique');
  for (const app of [...APPS, ...HOLDOUT]) {
    if (app.clean) assert.equal(app.issues.length, 0, `${app.name} is a clean control`);
    const ids = app.issues.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, `${app.name} issue ids are unique`);
    for (const issue of app.issues) {
      const specs = [...(issue.detect.repo ?? []), ...(issue.detect.web ?? [])];
      assert.ok(specs.length, `${app.name}/${issue.id} has a detection spec`);
      for (const s of specs) assert.ok(RULES[s.rule], `${app.name}/${issue.id}: unknown rule ${s.rule}`);
    }
  }
});

test('development set: every flaw within reach found, clean controls stay clean', async () => {
  const result = await runEvaluation(APPS);
  assert.deepEqual(result.missedInReach, []);
  assert.equal(result.falsePositives.filter((f) => f.clean).length, 0);
});

test('held-out set: every flaw within reach found, only the known Maps-key false alarm', async () => {
  const result = await runEvaluation(HOLDOUT);
  assert.deepEqual(result.missedInReach, []);
  for (const f of result.falsePositives) {
    assert.ok(f.ruleId === 'VP-ENV-002' && f.evidence.includes('VITE_MAPS_API_KEY'), `unexpected false alarm: ${f.app} ${f.ruleId} ${f.evidence}`);
  }
});
