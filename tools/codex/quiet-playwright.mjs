import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { root, plan, selectAssignment, playwrightListSelector } from '../ci/plan-test-shards.mjs';
import { readJson, runCaptured, validatePlaywright, writeMeasurements } from '../ci/collect-test-durations.mjs';

const directory = path.join(root, '.codex/logs/playwright');
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
    plan('e2e', count, directory);
    selected = selectAssignment(JSON.parse(readFileSync(path.join(directory, 'assignment.json'), 'utf8')), index, 'e2e', count);
    const list = path.join(directory, 'selected.txt');
    const selectors = selected.map(test => playwrightListSelector(test.id));
    if (new Set(selectors).size !== selectors.length) throw new Error('Duplicate Playwright selection');
    writeFileSync(list, `${selectors.join('\n')}\n`);
    if (readFileSync(list, 'utf8').trim() !== selectors.join('\n')) throw new Error('Cannot load test list');
    filters = [`--test-list=${list}`];
    // Ask Playwright to resolve the list before launching any browsers.
    const discovered = path.join(directory, 'selected-discovery.json');
    const check = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...filters,
      '--list', '--reporter=./tools/ci/collect-test-durations.mjs'], { cwd: root, encoding: 'utf8',
      timeout: 60_000, maxBuffer: 1024 * 1024, env: { ...process.env, PFM_DISCOVERY: discovered } });
    if (check.status !== 0 || check.error) throw new Error(`Selected discovery failed: ${check.stderr}`);
    const actual = JSON.parse(readFileSync(discovered, 'utf8'));
    const expectedIds = selected.map(t => t.id).sort();
    if (actual.length !== expectedIds.length || actual.map(t => t.id).sort().some((id, i) => id !== expectedIds[i])) {
      throw new Error('Playwright test-list does not match assignment');
    }
  }
  const reportFile = path.join(directory, 'report.json');
  const result = await runCaptured(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...filters,
    '--reporter=json,./tools/ci/collect-test-durations.mjs'], { directory, kind: 'e2e',
    env: { PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile } });
  const report = readJson(reportFile);
  writeMeasurements(directory, 'e2e', report);
  const valid = validatePlaywright(report, selected);
  result.summary.status = result.ok && valid ? 'passed' : 'failed';
  result.summary.reportValid = valid; result.save();
  console.log(`${result.summary.status.toUpperCase()} playwright exit=${result.summary.exit} signal=${result.summary.signal} context=${result.summary.context}; diagnostics: ${directory}`);
  if (result.summary.status !== 'passed') process.exitCode = 1;
} catch (error) {
  writeFileSync(path.join(directory, 'planning-error.json'), JSON.stringify({
    sha: process.env.GITHUB_SHA ?? null, status: 'failed', message: String(error) }));
  console.error(`FAIL playwright: ${error}`);
  process.exitCode = 1;
}
