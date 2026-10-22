import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Dynamic URL imports keep the dependency-free .mjs tools executable in Node
// without introducing a second TypeScript build or repository dependencies.
const plannerUrl = new URL('../tools/ci/plan-test-shards.mjs', import.meta.url).href;
const collectorUrl = new URL('../tools/ci/collect-test-durations.mjs', import.meta.url).href;
const { partition, validatePartition, selectAssignment, playwrightListSelector } = await import(plannerUrl);
const { validateVitest, validatePlaywright, runCaptured, playwrightInventory, verifyShardEvidence } = await import(collectorUrl);
type TestIdentity = { id: string; group?: string };
const baseline = { unknownMs: 100, durations: { expensive: 10000 } };
const inventory: TestIdentity[] = ['expensive', 'same-a', 'same-b', 'épargne › 日本語', 'renamed'].map(id => ({ id }));

describe('complete deterministic duration balancing', () => {
  it('is independent of input order and same-cost ties for 1..N shards', () => {
    for (let count = 1; count <= inventory.length; count++) {
      const forward = partition(inventory, count, baseline);
      expect(partition([...inventory].reverse(), count, baseline)).toEqual(forward);
      expect(partition([...inventory.slice(2), ...inventory.slice(0, 2)], count, baseline)).toEqual(forward);
      expect(forward.shards.flat().map((test: TestIdentity) => test.id).sort()).toEqual(inventory.map(t => t.id).sort());
      validatePartition(inventory, forward.shards);
    }
    expect(partition(inventory, 3, baseline).shards[0]).toEqual([{ id: 'expensive' }]);
  });
  it('never drops unseen, renamed or removed historical identities', () => {
    const changed = inventory.filter(t => t.id !== 'same-a').concat({ id: 'new title' });
    const result = partition(changed, 4, { ...baseline, durations: { ...baseline.durations, deleted: 999999 } });
    expect(result.shards.flat()).toHaveLength(changed.length);
    expect(result.shards.flat()).toContainEqual({ id: 'new title' });
    expect(result.shards.flat()).not.toContainEqual({ id: 'deleted' });
    expect(() => validatePartition(inventory, result.shards)).toThrow();
  });
  it('keeps serial groups atomic and rejects split/duplicate/omitted assignments', () => {
    const grouped = inventory.map((t, i) => i < 2 ? { ...t, group: 'serial' } : t);
    const result = partition(grouped, 4, baseline);
    expect(result.shards.some((tests: TestIdentity[]) => tests.filter(t => t.group === 'serial').length === 2)).toBe(true);
    expect(() => validatePartition(grouped, grouped.map(t => [t]))).toThrow(/serial/);
    expect(() => validatePartition(inventory, [[...inventory, inventory[0]]])).toThrow();
    expect(() => validatePartition(inventory, [inventory.slice(1)])).toThrow();
    expect(() => partition([...inventory, inventory[0]], 3, baseline)).toThrow();
  });
  it('rejects malformed duration data, identities, missing lists and selected-empty shards', () => {
    for (const value of [0, -1, NaN, Infinity, '10', null]) {
      expect(() => partition(inventory, 3, { unknownMs: value })).toThrow();
      expect(() => partition(inventory, 3, { unknownMs: 10, durations: { a: value } })).toThrow();
    }
    for (const count of [0, -1, 1.5, 65]) expect(() => partition(inventory, count, baseline)).toThrow();
    expect(() => partition([{ id: 'line\nbreak' }], 1, baseline)).toThrow();
    expect(() => partition([], 1, baseline)).toThrow();
    const proof = { kind: 'unit', count: 2, inventory: [{ id: 'one' }], shards: [[{ id: 'one' }], []], sha: process.env.GITHUB_SHA ?? null };
    expect(() => selectAssignment(proof, 2, 'unit', 2)).toThrow(/empty/);
    expect(() => selectAssignment(proof, 1, 'e2e', 2)).toThrow();
    expect(() => selectAssignment({ ...proof, shards: [] }, 1, 'unit', 2)).toThrow();
    expect(() => selectAssignment(undefined, 1, 'unit', 2)).toThrow();
  });
  it('keeps an entire serial file together without grouping unrelated files', () => {
    const project = { name: 'chromium' };
    const root = { type: 'root', _parallelMode: 'none', parent: undefined };
    const file = { type: 'file', _parallelMode: 'parallel', parent: root, project: () => project };
    const serial = { type: 'describe', _parallelMode: 'serial', parent: file, project: () => project };
    const tests = [serial, file].map((parent, index) => ({ parent,
      titlePath: () => ['', 'chromium', 'e2e/sample.spec.ts', `title ${index}`],
      location: { file: join(process.cwd(), 'e2e/sample.spec.ts'), line: index + 1, column: 1 } }));
    const result = playwrightInventory({ allTests: () => tests });
    expect(result[0].group).toBe(result[1].group);
    expect(result[0].id).toContain('[chromium] › e2e/sample.spec.ts:1:1 › title 0');
    expect(() => playwrightInventory({ allTests: () => [{ ...tests[0], parent: {} }] })).toThrow();
  });
});

it('formats testDir-relative Playwright test lists without modifying canonical evidence identities', () => {
  expect(playwrightListSelector('e2e/personal-mvp.spec.ts:54:1 › long finance title'))
    .toBe('personal-mvp.spec.ts:54:1 › long finance title');
  expect(playwrightListSelector('[chromium] › e2e/deep/flow.spec.ts:8:1 › outer › 日本語'))
    .toBe('[chromium] › deep/flow.spec.ts:8:1 › outer › 日本語');
  expect(() => playwrightListSelector('src/finance.test.ts:8:1 › unknown')).toThrow();
  expect(() => playwrightListSelector('e2e/only-directory')).toThrow();
});

describe('structured result and process truth', () => {
  it('requires every exact-head child receipt, including unchanged assignment proofs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pfm-receipts-'));
    try {
      const tests = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
      const proof = { sha: 'exact', kind: 'unit', count: 3, inventory: tests,
        shards: tests.map(t => [t]) };
      const good = { sha: 'exact', status: 'passed', exit: 0, signal: null, context: null, reportValid: true };
      const receipt = (index: number, execution: object, assignment = proof) => {
        const destination = join(directory, `unit-diagnostics-${index}-exact`);
        mkdirSync(destination, { recursive: true });
        writeFileSync(join(destination, 'execution.json'), JSON.stringify(execution));
        writeFileSync(join(destination, 'assignment.json'), JSON.stringify(assignment));
      };
      for (let index = 1; index <= 3; index++) receipt(index, good);
      expect(() => verifyShardEvidence(directory, 'unit', 3, 'exact')).not.toThrow();
      for (const bad of [{ ...good, status: 'cancelled' }, { ...good, status: 'running/incomplete' },
        { ...good, signal: 'SIGTERM' }, { ...good, exit: 1 }, { ...good, reportValid: false }, { ...good, sha: 'stale' }]) {
        receipt(2, bad);
        expect(() => verifyShardEvidence(directory, 'unit', 3, 'exact')).toThrow();
      }
      receipt(2, good, { ...proof, shards: [[tests[1]!], [tests[0]!], [tests[2]!]] });
      expect(() => verifyShardEvidence(directory, 'unit', 3, 'exact')).toThrow(/drift/);
      receipt(2, good);
      rmSync(join(directory, 'unit-diagnostics-3-exact/execution.json'));
      expect(() => verifyShardEvidence(directory, 'unit', 3, 'exact')).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  const unit = () => ({ success: true, numTotalTests: 1, numFailedTests: 0,
    testResults: [{ name: join(process.cwd(), 'test/example.test.ts'), status: 'passed', assertionResults: [{ status: 'passed' }] }] });
  const browser = () => ({ config: { rootDir: join(process.cwd(), 'e2e') }, errors: [],
    stats: { expected: 1, flaky: 0, unexpected: 0, skipped: 0 },
    suites: [{ title: 'sample.spec.ts', specs: [{ file: 'sample.spec.ts', line: 1, column: 1, title: '日本語 › title',
      tests: [{ projectName: '', expectedStatus: 'passed', status: 'expected', results: [{ retry: 0, duration: 12, status: 'passed' }] }] }] }] });
  it('rejects absent, partial, empty, mismatched and failed reports', () => {
    expect(validateVitest(unit(), [{ id: 'test/example.test.ts' }])).toBe(true);
    expect(validatePlaywright(browser(), [{ id: 'e2e/sample.spec.ts:1:1 › 日本語 › title' }])).toBe(true);
    for (const report of [undefined, {}, { success: true }, { ...unit(), numTotalTests: 0 },
      { ...unit(), success: false }, { ...unit(), testResults: [] }]) expect(validateVitest(report)).toBe(false);
    for (const report of [undefined, {}, { ...browser(), suites: [] },
      { ...browser(), errors: [{ message: 'worker terminated' }] },
      { ...browser(), stats: { expected: 0, flaky: 0, unexpected: 1, skipped: 0 } }]) expect(validatePlaywright(report)).toBe(false);
    expect(validateVitest(unit(), [{ id: 'missing' }])).toBe(false);
    expect(validatePlaywright(browser(), [{ id: 'missing' }])).toBe(false);
    const partial = browser(); partial.suites[0]!.specs[0]!.tests[0]!.results = [];
    expect(validatePlaywright(partial)).toBe(false);
    const interrupted = browser(); interrupted.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = 'interrupted';
    expect(validatePlaywright(interrupted)).toBe(false);
  });
  it('retains a named multi-test hang, terminates the process group, and fails closed', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pfm-hang-'));
    try {
      const code = `const fs = require('node:fs');
        fs.appendFileSync(process.env.PFM_PROGRESS, JSON.stringify({phase:'end',id:'first',attempt:0,status:'passed',durationMs:2})+'\\n');
        fs.appendFileSync(process.env.PFM_PROGRESS, JSON.stringify({phase:'start',id:'hanging second',attempt:1})+'\\n');
        console.log('started hanging second'); setInterval(()=>{}, 1000);`;
      const result = await runCaptured(process.execPath, ['-e', code], { directory, kind: 'synthetic', deadlineMs: 1000, graceMs: 100 });
      expect(result.ok).toBe(false);
      expect(result.summary.context).toBe('deadline-exceeded');
      expect(JSON.parse(readFileSync(join(directory, 'execution.json'), 'utf8')).status).toBe('failed');
      expect(readFileSync(join(directory, 'progress.jsonl'), 'utf8')).toContain('hanging second');
      expect(readFileSync(join(directory, 'runner.log'), 'utf8')).toContain('started hanging second');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('preserves nonzero, signal and no-report outcomes independently of assertions', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pfm-process-'));
    try {
      for (const code of ['process.exit(7)', "process.kill(process.pid, 'SIGTERM')", 'process.exit(0)']) {
        const result = await runCaptured(process.execPath, ['-e', code], { directory, kind: 'synthetic', deadlineMs: 2000 });
        expect(result.ok && validateVitest(undefined)).toBe(false);
        expect(result.ok && validatePlaywright(undefined)).toBe(false);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('executes runner arguments in an isolated CLI double and rejects extra selection/missing reports', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pfm-wrapper-'));
    try {
      for (const sub of ['tools/ci', 'tools/codex', 'node_modules/vitest', 'node_modules/@playwright/test']) mkdirSync(join(directory, sub), { recursive: true });
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      writeFileSync(join(directory, 'node_modules/@playwright/test/package.json'), '{"type":"module"}');
      for (const file of ['tools/ci/plan-test-shards.mjs', 'tools/ci/collect-test-durations.mjs',
        'tools/codex/quiet-vitest.mjs', 'tools/codex/quiet-playwright.mjs']) copyFileSync(new URL(`../${file}`, import.meta.url), join(directory, file));
      const stub = `import {writeFileSync} from 'node:fs'; writeFileSync('args.json', JSON.stringify(process.argv.slice(2))); process.exit(0);`;
      writeFileSync(join(directory, 'node_modules/vitest/vitest.mjs'), stub);
      writeFileSync(join(directory, 'node_modules/@playwright/test/cli.js'), stub);
      for (const runner of ['vitest', 'playwright']) {
        const result = spawnSync(process.execPath, [`tools/codex/quiet-${runner}.mjs`], { cwd: directory, encoding: 'utf8' });
        expect(result.status).toBe(1); // clean child exit cannot bless an absent report
        const args = JSON.parse(readFileSync(join(directory, 'args.json'), 'utf8')) as string[];
        expect(args.some(arg => arg.startsWith('--reporter='))).toBe(true);
        const invalid = spawnSync(process.execPath, [`tools/codex/quiet-${runner}.mjs`, '--balanced-shard=1/4', '--shard=1/4'], { cwd: directory, encoding: 'utf8' });
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('additional selectors');
      }
      writeFileSync(join(directory, 'tools/ci/test-duration-baseline.json'), JSON.stringify({
        e2e: { unknownMs: 10, durations: {} }, unit: { unknownMs: 10, durations: {} } }));
      // Exercise the complete balanced wrapper path with a tiny CLI double.
      // No browser, dev server or forecast is created by this process-control test.
      writeFileSync(join(directory, 'node_modules/@playwright/test/cli.js'), `
        import {readFileSync,writeFileSync} from 'node:fs';
        const args = process.argv.slice(2);
        const all = Array.from({length:4},(_,i)=>({id:'e2e/sample.spec.ts:'+(i+1)+':1 › case '+(i+1)}));
        const list = args.find(a=>a.startsWith('--test-list='));
        const selected = list ? readFileSync(list.slice(12),'utf8').trim().split('\\n').map(id=>({id})) : all;
        if(args.includes('--list')) {
          writeFileSync(process.env.PFM_DISCOVERY,JSON.stringify(selected));
        } else {
          writeFileSync('selected-args.json',JSON.stringify(args));
          const specs=selected.map(({id})=>{
            const n=Number(id.match(/:(\\d+):1/)[1]);
            return {file:'sample.spec.ts',line:n,column:1,title:'case '+n,
              tests:[{projectName:'',expectedStatus:'passed',status:'expected',results:[{retry:0,duration:1,status:'passed'}]}]};
          });
          writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE,JSON.stringify({
            config:{rootDir:process.cwd()+'/e2e'},errors:[],stats:{expected:selected.length,flaky:0,unexpected:0,skipped:0},
            suites:[{title:'sample.spec.ts',specs}]}));
        }
      `);
      const union: string[] = [];
      for (let shard = 1; shard <= 4; shard++) {
        const result = spawnSync(process.execPath, ['tools/codex/quiet-playwright.mjs', `--balanced-shard=${shard}/4`], {
          cwd: directory, encoding: 'utf8', env: { ...process.env, PFM_DISCOVERY: '' },
        });
        expect(result.status, result.stderr).toBe(0);
        const args = JSON.parse(readFileSync(join(directory, 'selected-args.json'), 'utf8')) as string[];
        expect(args.some(arg => arg.startsWith('--test-list='))).toBe(true);
        expect(args.some(arg => arg.startsWith('--shard='))).toBe(false);
        const selected = readFileSync(join(directory, '.codex/logs/playwright/selected.txt'), 'utf8').trim().split('\n');
        expect(selected).toHaveLength(1);
        union.push(...selected);
      }
      expect(new Set(union).size).toBe(4);
      mkdirSync(join(directory, 'test'));
      for (let i = 1; i <= 3; i++) writeFileSync(join(directory, `test/file${i}.test.ts`), '// discovery fixture');
      expect(spawnSync('git', ['init', '-q'], { cwd: directory }).status).toBe(0);
      expect(spawnSync('git', ['add', 'test'], { cwd: directory }).status).toBe(0);
      writeFileSync(join(directory, 'node_modules/vitest/vitest.mjs'), `
        import {readFileSync,writeFileSync} from 'node:fs';
        const args=process.argv.slice(2);
        if(args[0]==='list') console.log(JSON.stringify([1,2,3].map(i=>'test/file'+i+'.test.ts')));
        else {
          const selected=JSON.parse(readFileSync(process.env.PFM_UNIT_ASSIGNMENT,'utf8'));
          writeFileSync('selected-unit.json',JSON.stringify({args,selected}));
          const report={success:true,numTotalTests:selected.length,numFailedTests:0,
            testResults:selected.map(name=>({name,status:'passed',startTime:0,endTime:1,assertionResults:[{status:'passed'}]}))};
          writeFileSync(args.find(a=>a.startsWith('--outputFile=')).slice(13),JSON.stringify(report));
        }
      `);
      const unitUnion: string[] = [];
      for (let shard = 1; shard <= 3; shard++) {
        const result = spawnSync(process.execPath, ['tools/codex/quiet-vitest.mjs', `--balanced-shard=${shard}/3`], {
          cwd: directory, encoding: 'utf8', env: { ...process.env, PFM_UNIT_ASSIGNMENT: '' },
        });
        expect(result.status, result.stderr).toBe(0);
        const { args, selected } = JSON.parse(readFileSync(join(directory, 'selected-unit.json'), 'utf8')) as { args: string[]; selected: string[] };
        expect(args[0]).toBe('run');
        expect(args).not.toContain('--shard');
        expect(selected).toHaveLength(1);
        unitUnion.push(...selected);
      }
      expect(new Set(unitUnion).size).toBe(3);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);
});
