import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { root, plan, selectAssignment } from '../ci/plan-test-shards.mjs';
import { readJson, runCaptured, validateVitest, writeMeasurements } from '../ci/collect-test-durations.mjs';

const directory = path.join(root, '.codex/logs/vitest');
rmSync(directory, { recursive: true, force: true });
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, 'execution.json'), JSON.stringify({
  sha: process.env.GITHUB_SHA ?? null, status: 'planning/incomplete' }));
try {
  const args = process.argv.slice(2);
  const balanced = args.find(arg => arg.startsWith('--balanced-shard='));
  let selected;
  let filters = args;
  if (balanced) {
    if (args.length !== 1) throw new Error('Balanced shards cannot accept additional selectors');
    const match = /^--balanced-shard=(\d+)\/(\d+)$/u.exec(balanced);
    if (!match) throw new Error('Invalid balanced shard');
    const index = Number(match[1]); const count = Number(match[2]);
    plan('unit', count, directory);
    selected = selectAssignment(JSON.parse(readFileSync(path.join(directory, 'assignment.json'), 'utf8')), index, 'unit', count);
    // Exact config includes, rather than Vitest positional substring filters.
    process.env.PFM_UNIT_ASSIGNMENT = path.join(directory, 'selected.json');
    writeFileSync(process.env.PFM_UNIT_ASSIGNMENT, JSON.stringify(selected.map(test => test.id)));
    filters = [];
  }
  const reportFile = path.join(directory, 'report.json');
  const result = await runCaptured(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...filters,
    '--reporter=json', '--reporter=default', '--reporter=./tools/ci/collect-test-durations.mjs',
    `--outputFile=${reportFile}`], { directory, kind: 'unit' });
  const report = readJson(reportFile);
  writeMeasurements(directory, 'unit', report);
  const valid = validateVitest(report, selected);
  result.summary.status = result.ok && valid ? 'passed' : 'failed';
  result.summary.reportValid = valid; result.save();
  console.log(`${result.summary.status.toUpperCase()} vitest exit=${result.summary.exit} signal=${result.summary.signal} context=${result.summary.context}; diagnostics: ${directory}`);
  if (result.summary.status !== 'passed') process.exitCode = 1;
} catch (error) {
  writeFileSync(path.join(directory, 'planning-error.json'), JSON.stringify({
    sha: process.env.GITHUB_SHA ?? null, status: 'failed', message: String(error) }));
  console.error(`FAIL vitest: ${error}`);
  process.exitCode = 1;
}
