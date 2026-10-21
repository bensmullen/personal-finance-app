// Synthetic scaling diagnosis, never a speed SLA or financial-completeness claim.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const directory = resolve('engineering-validation-artifacts/forecast-feasibility');
mkdirSync(directory, { recursive: true });
if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required');

if (args[0] === '--probe' && args.length === 3) {
  const months = Number(args[1]);
  if (![8, 20, 120, 360, 649].includes(months) || !['ordinary', 'manual'].includes(args[2])) throw new Error('Invalid probe');
  if (args[2] === 'ordinary' && months > 20) throw new Error('Heavy probe excluded from ordinary CI');
  const { createRealisticPerformanceFixture } = await import('../../test/fixtures/performanceHouseholds.ts');
  const { runPersonalHouseholdForecast } = await import('../../src/application/index.ts');
  const { createApplicationPerformanceObserver } = await import('../../src/application/performance.ts');
  const { PerformanceRegistry, PERFORMANCE_PHASES } = await import('../../src/diagnostics/performance.ts');
  const fixture = createRealisticPerformanceFixture();
  const start = fixture.request.compiler.cashFlow.simulationStart;
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  const end = date.toISOString().slice(0, 10);
  const endInstant = `${end}T00:00:00.000Z`;
  const model = { ...fixture.model, objects: { ...fixture.model.objects,
    Scenario: fixture.model.objects.Scenario.map(scenario => ({ ...scenario, end_date: end })) } };
  const compiler = { ...fixture.request.compiler };
  for (const key of ['cashFlow', 'investments', 'liabilities']) {
    compiler[key] = { ...compiler[key], simulationEnd: end, months };
  }
  const request = { ...fixture.request, compiler };
  const registry = new PerformanceRegistry();
  const started = performance.now();
  const result = runPersonalHouseholdForecast(model, request, createApplicationPerformanceObserver(
    { now: () => performance.now() }, { runId: `feasibility:${months}`, fixtureId: fixture.id,
      dataClassification: 'synthetic', modelCounts: fixture.coverage.canonicalObjectCounts,
      executionLocation: 'local_node', runtime: process.version, cacheState: 'not_applicable' }, registry));
  const wallMs = performance.now() - started;
  const heapUsedBytes = process.memoryUsage().heapUsed;
  const executed = ['completed', 'incomplete'].includes(result.status) && !result.executionError &&
    result.requestedHorizon?.end === endInstant && result.reachedThrough === endInstant && result.points?.length === months;
  let equality = 'not measured';
  let referenceEquality = 'not measured';
  if (executed && args[2] === 'manual') {
    const repeated = runPersonalHouseholdForecast(model, request);
    const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    equality = digest(result) === digest(repeated) ? 'equal' : 'different';
    // Existing R3 reference contract, scoped to compiled deterministic kernel.
    // Application tax participants and worker transport remain separate evidence.
    const { compileHouseholdProjection } = await import('../../src/application/compiler/householdProjection.ts');
    const { runHouseholdKernel } = await import('../../src/simulation/householdExecution.ts');
    const { runCompiledHouseholdProjection: referenceRun } = await import('../../src/simulation/r3/referenceHouseholdExecution.ts');
    const { summarizeHouseholdPeriod } = await import('../../src/simulation/r3/forecastSummary.ts');
    const { createRunContext, runId, scenarioId, canonicalSerialize } = await import('../../src/simulation/run.ts');
    const { instant } = await import('../../src/time/index.ts');
    const { Currency } = await import('../../src/values/index.ts');
    const compiled = compileHouseholdProjection(model, compiler);
    if (compiled.status !== 'compiled' || !compiled.value.executionKernel) throw new Error('Reference fixture did not compile');
    const kernel = compiled.value.executionKernel;
    const runContext = createRunContext({ runId: runId(request.runIdentity), scenarioId: scenarioId(kernel.executable.scenarioIdentity),
      asOf: instant(`${request.asOf}T00:00:00.000Z`), dataCutoff: instant(`${request.dataCutoff}T00:00:00.000Z`),
      simulationStart: instant(`${start}T00:00:00.000Z`), simulationEnd: instant(`${end}T00:00:00.000Z`),
      baseCurrency: Currency.of(compiler.cashFlow.baseCurrency) });
    const summary = runHouseholdKernel({ kernel, runContext });
    const reference = referenceRun({ compiled: kernel.executable, runContext });
    const select = run => ({ status: run.status, requestedHorizon: run.requestedHorizon,
      reachedThrough: run.reachedThrough, state: run.state, primitiveState: run.primitiveState,
      runMetadata: run.runMetadata, diagnostics: run.diagnostics, periods: run.periods });
    referenceEquality = summary.status === 'completed' && reference.status === 'completed' &&
      summary.reachedThrough === runContext.simulationEnd && reference.reachedThrough === runContext.simulationEnd &&
      summary.periods.length === months && reference.periods.length === months &&
      canonicalSerialize(select(summary)) === canonicalSerialize(select({ ...reference,
        periods: reference.periods.map(summarizeHouseholdPeriod) })) ? 'equal' : 'different';
  }
  const evidence = { months, fixture: fixture.id, classification: 'synthetic', status: result.status,
    executionError: result.executionError === true, reachedThrough: result.reachedThrough ?? null,
    periodCount: result.points?.length ?? 0, executed, financialCompleteness: result.status === 'completed',
    wallMs, heapUsedBytes, heapMeaning: 'sampled after forecast, not peak',
    diagnosticCounts: Object.fromEntries([...new Set(result.diagnostics.map(d => d.code))]
      .map(code => [code, result.diagnostics.filter(d => d.code === code).length])),
    phases: Object.fromEntries(PERFORMANCE_PHASES.map(phase => [phase, registry.latest(phase) ?? 'not measured'])),
    worker: { status: 'not measured', reason: 'existing synthetic fixture executes local_node; worker evidence remains #181-owned' },
    financialEquality: { repeatExecution: equality, optimizedVsReference: referenceEquality,
      scope: 'compiled deterministic kernel; application tax participants and worker transport not measured' } };
  writeFileSync(resolve(directory, `${months}.json`), JSON.stringify(evidence, null, 2) + '\n');
  if (!executed || equality === 'different' || referenceEquality === 'different') process.exitCode = 1;
} else {
  if (args.length > 1 || (args[0] && args[0] !== '--manual')) throw new Error('Use no arguments or --manual');
  const mode = args[0] ? 'manual' : 'ordinary';
  const months = mode === 'manual' ? [8, 20, 120, 360, 649] : [8, 20];
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0) throw new Error('Exact head unavailable');
  const probes = [];
  let failed = false;
  for (const horizon of months) {
    if (failed) { probes.push({ months: horizon, status: 'not measured', reason: 'smaller probe failed; progression stopped' }); continue; }
    const fd = openSync(resolve(directory, `${horizon}.log`), 'w');
    // Never read a prior run's artifact as evidence for a killed subprocess.
    const file = resolve(directory, `${horizon}.json`);
    writeFileSync(file, 'null\n');
    const started = performance.now();
    const run = spawnSync(process.execPath, [`--max-old-space-size=${mode === 'manual' ? 2048 : 512}`,
      'node_modules/vite-node/vite-node.mjs', 'tools/ci/forecast-feasibility.mjs', '--probe', String(horizon), mode],
    { timeout: mode === 'manual' ? 120_000 : 30_000, killSignal: 'SIGKILL', stdio: ['ignore', fd, fd],
      env: { ...process.env, NODE_OPTIONS: '' } });
    closeSync(fd);
    const measured = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    failed = run.status !== 0 || !measured?.executed;
    probes.push({ months: horizon, processExit: run.status, signal: run.signal,
      error: run.error?.code ?? null, processWallMs: performance.now() - started,
      status: failed ? 'FAIL' : 'PASS', evidence: measured ?? 'not measured' });
  }
  const artifact = { capturedHead: head.stdout.trim(), runtime: process.version, mode,
    meaning: 'bounded feasibility only; no speed SLA; #181 requires separate worker/reference equality and 649-month success',
    ceilings: { perProbeMs: mode === 'manual' ? 120_000 : 30_000, nodeHeapMiB: mode === 'manual' ? 2048 : 512 }, probes };
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(artifact, null, 2) + '\n');
  console.log(`${failed ? 'FAIL' : 'PASS'} forecast feasibility (${mode}); artifact=${directory}/summary.json`);
  process.exitCode = failed ? 1 : 0;
}
