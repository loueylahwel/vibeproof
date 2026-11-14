import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RULES } from '../dist/rules.js';
import { APPS } from '../lab/catalog.mjs';
import { runEvaluation } from '../lab/evaluate.mjs';

test('ground truth is consistent', () => {
  const names = APPS.map((a) => a.name);
  assert.equal(new Set(names).size, names.length, 'app names are unique');
  for (const app of APPS) {
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

test('evaluation: no false alarms on clean controls, no regressions outside the hard cases', async () => {
  const result = await runEvaluation();
  assert.equal(result.falsePositives.filter((f) => f.clean).length, 0, 'clean controls must stay clean');
  const hard = new Set(APPS.filter((a) => a.hard).map((a) => a.name));
  const regressions = result.missedInReach.filter((m) => !hard.has(m.app));
  assert.deepEqual(regressions, [], 'every flaw outside the hard cases must still be found within reach');
});
