// Synthetic scaling diagnosis, never a speed SLA or financial-completeness claim.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { types } from 'node:util';

const args = process.argv.slice(2);
const directory = resolve('engineering-validation-artifacts/forecast-feasibility');
const entry = process.argv[1];
const invoked = entry !== undefined && (resolve(entry) === fileURLToPath(import.meta.url) ||
  (basename(entry) === 'vite-node.mjs' && args[0] === '--probe'));
if (invoked) {
  mkdirSync(directory, { recursive: true });
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Node 22 required');
}

const diagnosticCounts = diagnostics => {
  const counts = new Map();
  for (const { code } of diagnostics) counts.set(code, (counts.get(code) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
};

const bounded = value => value.length <= 160 ? value : `${value.slice(0, 157)}...`;

// Only fixed runtime messages can leave this probe. Compiler and replay errors
// can include model content, even when the input fixture is synthetic.
const safeMessages = new Set([
  'Invalid string length', 'Maximum call stack size exceeded',
  'Do not know how to serialize a BigInt', 'Cyclic forecast read model',
  'Missing forecast read model', 'Unsupported raw JSON in forecast read model',
]);
const safeErrorMessage = message => safeMessages.has(message) ? bounded(message) : 'Message withheld';
const safeErrorNames = new Set(['RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'ValidationError']);

// Hash the entire JSON-visible model in order with explicit container and
// scalar boundaries. Each long string is hashed once by content. In particular,
// period replay anchors all carry the same large encoded replay basis, which
// JSON.stringify would expand once per anchor into a single output string.
export function digestForecastReadModel(root) {
  const hash = createHash('sha256');
  const longStrings = new Map();
  const active = new Set();
  const chunkSize = 8_192;
  let buffer = '';
  const write = token => {
    buffer += token;
    if (buffer.length >= chunkSize) {
      hash.update(buffer);
      buffer = '';
    }
  };
  const writeString = value => {
    if (value.length < chunkSize) {
      write(JSON.stringify(value));
      return;
    }
    let digest = longStrings.get(value);
    if (digest === undefined) {
      const content = createHash('sha256');
      for (let offset = 0; offset < value.length; offset += chunkSize) {
        content.update(value.slice(offset, offset + chunkSize), 'utf16le');
      }
      digest = content.digest('hex');
      longStrings.set(value, digest);
    }
    write(`~${value.length}:${digest}`);
  };
  const jsonValue = (value, key) => {
    if ((value !== null && (typeof value === 'object' || typeof value === 'function')) ||
        typeof value === 'bigint') {
      const toJSON = value.toJSON;
      if (typeof toJSON === 'function') value = Reflect.apply(toJSON, value, [key]);
    }
    if (types.isNumberObject(value)) return +value;
    if (types.isStringObject(value)) return String(value);
    if (types.isBooleanObject(value)) return Boolean.prototype.valueOf.call(value);
    if (types.isBigIntObject(value)) return BigInt.prototype.valueOf.call(value);
    return value;
  };
  const omitted = value => value === undefined || typeof value === 'function' || typeof value === 'symbol';
  const visit = value => {
    if (typeof value === 'string') {
      writeString(value);
      return;
    }
    if (typeof value === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
    if (value === null || typeof value !== 'object') {
      write(JSON.stringify(value));
      return;
    }
    if (JSON.isRawJSON?.(value)) throw new TypeError('Unsupported raw JSON in forecast read model');
    if (active.has(value)) throw new TypeError('Cyclic forecast read model');
    active.add(value);
    if (Array.isArray(value)) {
      const length = value.length;
      write(`[${length}:`);
      for (let index = 0; index < length; index++) {
        const item = jsonValue(value[index], String(index));
        if (index > 0) write(',');
        visit(omitted(item) ? null : item);
      }
      write(']');
    } else {
      write('{');
      for (const key of Object.keys(value)) {
        const item = jsonValue(value[key], key);
        if (omitted(item)) continue;
        writeString(key);
        write(':');
        visit(item);
        write(',');
      }
      write('}');
    }
    active.delete(value);
  };
  const value = jsonValue(root, '');
  if (omitted(value)) throw new TypeError('Missing forecast read model');
  visit(value);
  return hash.update(buffer).digest('hex');
}

const record = value => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// Walk containers incrementally so a mismatch never requires serializing the
// entire terminal state or retaining a second array of summarized periods.
function firstDifference(optimized, reference, path, serialize) {
  if (optimized === reference && (typeof optimized !== 'number' || Number.isFinite(optimized))) return null;
  const difference = (left, right, field = path) => ({
    path: bounded(field), optimized: left, reference: right,
  });
  if (Array.isArray(optimized) && Array.isArray(reference)) {
    if (optimized.length !== reference.length) return difference(
      optimized.length, reference.length, `${path}.length`);
    for (let index = 0; index < optimized.length; index++) {
      const mismatch = firstDifference(optimized[index], reference[index], `${path}[${index}]`, serialize);
      if (mismatch) return mismatch;
    }
    return null;
  }
  if (record(optimized) && record(reference)) {
    const keys = [...new Set([...Object.keys(optimized), ...Object.keys(reference)])].sort();
    for (const key of keys) {
      const mismatch = firstDifference(
        Object.hasOwn(optimized, key) ? optimized[key] : undefined,
        Object.hasOwn(reference, key) ? reference[key] : undefined,
        `${path}[${JSON.stringify(key)}]`, serialize);
      if (mismatch) return mismatch;
    }
    return null;
  }
  const describe = value => {
    if (value === undefined) return { kind: 'missing' };
    if (Array.isArray(value)) return { kind: 'array', length: value.length };
    if (record(value)) return { kind: 'record' };
    const kind = value === null ? 'null' : typeof value === 'object' ? value.constructor.name : typeof value;
    return { kind, value: bounded(serialize(value)) };
  };
  if (optimized !== undefined && reference !== undefined &&
      !Array.isArray(optimized) && !Array.isArray(reference) &&
      !record(optimized) && !record(reference) &&
      serialize(optimized) === serialize(reference)) return null;
  return difference(describe(optimized), describe(reference));
}

function coverage(run, periods, expected, boundaries) {
  const firstPeriodMismatch = periods.slice(0, expected.length).findIndex((period, index) => {
    const actual = boundaries(period);
    return actual.start !== expected[index].start || actual.end !== expected[index].end;
  });
  const start = expected[0].start;
  const end = expected.at(-1).end;
  return {
    status: run.status,
    requestedHorizon: run.requestedHorizon ?? null,
    reachedThrough: run.reachedThrough ?? null,
    stoppedAt: run.stoppedAt ?? null,
    periodCount: periods.length,
    firstPeriodMismatch: firstPeriodMismatch === -1 ? null : {
      index: firstPeriodMismatch, expected: expected[firstPeriodMismatch],
      actual: boundaries(periods[firstPeriodMismatch]),
    },
    complete: run.stoppedAt === undefined && run.reachedThrough === end &&
      run.requestedHorizon?.start === start && run.requestedHorizon?.end === end &&
      periods.length === expected.length && firstPeriodMismatch === -1,
  };
}

function compareKernelRuns(summary, reference, expected, executable, summarize, serialize, taxDiagnosticKey) {
  const optimizedCoverage = coverage(summary, summary.periods, expected, value => value.period);
  const referenceCoverage = coverage(reference, reference.periods, expected, value => value.period);
  const capabilities = Object.entries(summary.outputCapabilities ?? {});
  const optimizedCapabilities = Object.fromEntries(capabilities.map(([field, value]) => [field, value.status]));
  const capabilityDiagnostics = [...new Set(capabilities.map(([, value]) => value))]
    .flatMap(value => value.diagnostics);
  const tax = executable.participants?.find(participant => participant.id === 'tax');
  const taxInput = tax?.economicInputs;
  // Without funding or settlement instructions, the tax participant returns
  // coverage evidence before its posting branch. The reference also lacks the
  // tax credit exclusion from the portfolio metric, so require no such positions.
  const participants = executable.participants ?? [];
  const supportedPlan = (participants.length === 0 ||
    (participants.length === 1 && tax && ['household-tax/v1', 'household-tax/v2'].includes(tax.portableCodec))) &&
    (!tax || (!taxInput.fundingPolicy && !taxInput.refundAccountId &&
      taxInput.payments.length === 0 && taxInput.settlements.length === 0)) &&
    (executable.nonInvestmentPositionIds ?? []).every(id =>
      !Object.hasOwn(summary.state.positions, id) && !Object.hasOwn(reference.state.positions, id));
  const evidence = {
    optimized: { ...optimizedCoverage, capabilities: optimizedCapabilities,
      diagnosticCounts: diagnosticCounts(summary.diagnostics),
      capabilityDiagnosticCodes: [...new Set(capabilityDiagnostics.map(value => value.code))].sort() },
    reference: { ...referenceCoverage, capabilities: 'not measured',
      diagnosticCounts: diagnosticCounts(reference.diagnostics) },
    firstEnvelopeDifference: null,
    firstFinancialDifference: null,
  };
  const compare = (left, right, path) => firstDifference(left, right, path, serialize);
  const { inputFingerprint: optimizedFingerprint, ...optimizedMetadata } = summary.runMetadata;
  const { inputFingerprint: referenceFingerprint, ...referenceMetadata } = reference.runMetadata;
  const differentFingerprintBasis = Boolean(tax || executable.nonInvestmentPositionIds !== undefined);
  evidence.inputFingerprints = { optimized: optimizedFingerprint, reference: referenceFingerprint,
    equality: differentFingerprintBasis ? 'not measured' :
      optimizedFingerprint === referenceFingerprint ? 'equal' : 'different',
    ...(differentFingerprintBasis ? { reason: 'frozen reference fingerprint excludes participants and tax credit position IDs' } : {}) };
  evidence.firstEnvelopeDifference = compare(summary.status, reference.status, '$.status') ??
    (differentFingerprintBasis ? compare(optimizedFingerprint, referenceFingerprint, '$.runMetadata.inputFingerprint') : null) ??
    (capabilities.length > 0 ? { path: '$.outputCapabilities', optimized: 'record', reference: 'missing' } : null);
  if (!optimizedCoverage.complete || !referenceCoverage.complete || reference.status !== 'completed') {
    evidence.failure = 'execution did not commit the requested horizon';
    return evidence;
  }
  const expectedStatus = capabilities.some(([, value]) => value.status === 'incomplete') ? 'incomplete' : 'completed';
  if (!supportedPlan || summary.status !== expectedStatus ||
      (!tax && (capabilities.length > 0 || summary.periods.some(period => period.outputCapabilities !== undefined))) ||
      reference.outputCapabilities !== undefined || reference.periods.some(period => period.outputCapabilities !== undefined) ||
      summary.diagnostics.some(issue => issue.severity === 'error') ||
      reference.diagnostics.some(issue => issue.severity === 'error')) {
    evidence.failure = 'unsupported participant, capability envelope, or execution error';
    return evidence;
  }
  if (summary.status !== reference.status) {
    evidence.statusExplanation = 'both committed the horizon; optimized tax coverage is incomplete and frozen reference tax coverage is not measured';
  }
  // Exclude only tax-participant warnings that exactly match a published
  // capability diagnostic. Compare every remaining occurrence in engine order.
  const capabilityKeys = new Set(capabilityDiagnostics.map(taxDiagnosticKey));
  const taxWarning = issue => issue.entityType === 'tax_capability' && issue.severity === 'warning' &&
    ['PFA-TAX-008', 'PFA-TAX-009'].includes(issue.code);
  const referenceTaxKeys = new Set(reference.diagnostics.filter(taxWarning).map(taxDiagnosticKey));
  const sharedDiagnostics = summary.diagnostics.filter(issue => {
    if (!tax || !taxWarning(issue)) return true;
    const key = taxDiagnosticKey(issue);
    return !capabilityKeys.has(key) || referenceTaxKeys.has(key);
  });
  evidence.optimized.capabilityOnlyDiagnosticCount = summary.diagnostics.length - sharedDiagnostics.length;
  evidence.firstFinancialDifference =
    compare(optimizedMetadata, referenceMetadata, '$.runMetadata') ??
    (differentFingerprintBasis ? null : compare(optimizedFingerprint, referenceFingerprint, '$.runMetadata.inputFingerprint')) ??
    compare(summary.state, reference.state, '$.state') ??
    compare(summary.primitiveState, reference.primitiveState, '$.primitiveState') ??
    compare(sharedDiagnostics, reference.diagnostics, '$.diagnostics');
  for (let index = 0; evidence.firstFinancialDifference === null && index < expected.length; index++) {
    const { outputCapabilities: _optimizedCapabilities, ...optimized } = summary.periods[index];
    const { outputCapabilities: _referenceCapabilities, ...frozen } = summarize(reference.periods[index]);
    evidence.firstFinancialDifference = compare(optimized, frozen, `$.periods[${index}]`);
  }
  return evidence;
}

if (invoked && args[0] === '--probe' && args.length === 3) {
  const months = Number(args[1]);
  if (![8, 20, 120, 360, 649].includes(months) || !['ordinary', 'manual'].includes(args[2])) throw new Error('Invalid probe');
  if (args[2] === 'ordinary' && months > 20) throw new Error('Heavy probe excluded from ordinary CI');
  const { createRealisticPerformanceFixture } = await import('../../test/fixtures/performanceHouseholds.ts');
  const { instant, utcMonthlyPeriods } = await import('../../src/time/index.ts');
  const { runPersonalHouseholdForecast } = await import('../../src/application/index.ts');
  const { createApplicationPerformanceObserver } = await import('../../src/application/performance.ts');
  const { PerformanceRegistry, PERFORMANCE_PHASES } = await import('../../src/diagnostics/performance.ts');
  const fixture = createRealisticPerformanceFixture(Math.max(24, months));
  let { model, request } = fixture;
  const start = request.compiler.cashFlow.simulationStart;
  const startInstant = instant(`${start}T00:00:00.000Z`);
  const expected = utcMonthlyPeriods(startInstant, months);
  // Short probes retain the 24-month fixture's original income lifecycle.
  if (months < fixture.dimensions.horizonMonths) {
    const end = expected.at(-1).end.slice(0, 10);
    model = { ...model, objects: { ...model.objects,
      Scenario: model.objects.Scenario.map(scenario => ({ ...scenario, end_date: end })) } };
    const compiler = { ...request.compiler };
    for (const key of ['cashFlow', 'investments', 'liabilities']) {
      compiler[key] = { ...compiler[key], simulationEnd: end, months };
    }
    request = { ...request, compiler };
  }
  const { compiler } = request;
  const end = compiler.cashFlow.simulationEnd;
  const endInstant = `${end}T00:00:00.000Z`;
  const registry = new PerformanceRegistry();
  const started = performance.now();
  let result = runPersonalHouseholdForecast(model, request, createApplicationPerformanceObserver(
    { now: () => performance.now() }, { runId: `feasibility:${months}`, fixtureId: fixture.id,
      dataClassification: 'synthetic', modelCounts: fixture.coverage.canonicalObjectCounts,
      executionLocation: 'local_node', runtime: process.version, cacheState: 'not_applicable' }, registry));
  const wallMs = performance.now() - started;
  const heapUsedBytes = process.memoryUsage().heapUsed;
  const applicationCoverage = coverage(result, result.points ?? [], expected,
    point => ({ start: point.periodStart, end: point.periodEnd }));
  const applicationCapabilities = result.points?.at(-1)?.outputCapabilities ?? {};
  const applicationCapabilityStatuses = Object.fromEntries(Object.entries(applicationCapabilities)
    .map(([field, capability]) => [field, capability.status]));
  const expectedApplicationStatus = Object.values(applicationCapabilityStatuses).includes('incomplete')
    ? 'incomplete' : 'completed';
  const executed = result.status === expectedApplicationStatus && !result.executionError &&
    applicationCoverage.complete && result.reachedThrough === endInstant &&
    !result.diagnostics.some(issue => issue.severity === 'error');
  const { status, executionError, reachedThrough } = result;
  const applicationDiagnosticCounts = diagnosticCounts(result.diagnostics);
  let equality = 'not measured';
  let referenceEquality = 'not measured';
  let referenceEvidence = 'not measured';
  let parityFailure;
  if (executed && args[2] === 'manual') {
    let stage = 'repeat_application_run';
    try {
      {
        const repeated = runPersonalHouseholdForecast(model, request);
        if (repeated.executionError) {
          throw new Error(repeated.message);
        }
        stage = 'serialize_first';
        const firstDigest = digestForecastReadModel(result);
        result = undefined;
        stage = 'serialize_repeat';
        const repeatedDigest = digestForecastReadModel(repeated);
        stage = 'compare_repeats';
        equality = firstDigest === repeatedDigest ? 'equal' : 'different';
      }
      stage = 'select canonical scenario';
      // Existing R3 reference contract, scoped to compiled deterministic kernel.
      // Application tax participants and worker transport remain separate evidence.
      const { compileHouseholdKernelForRun } = await import('../../src/application/householdProjection.ts');
      const { selectScenario } = await import('../../src/application/compiler/scenarioSelection.ts');
      const { runHouseholdKernel } = await import('../../src/simulation/householdExecution.ts');
      const { runCompiledHouseholdProjection: referenceRun } = await import('../../src/simulation/r3/referenceHouseholdExecution.ts');
      const { summarizeHouseholdPeriod } = await import('../../src/simulation/r3/forecastSummary.ts');
      const { createRunContext, runId, scenarioId, canonicalSerialize } = await import('../../src/simulation/run.ts');
      const { Currency } = await import('../../src/values/index.ts');
      const { createTaxDiagnosticKey } = await import('../../src/simulation/tax/contracts.ts');
      const selected = selectScenario(model, {
        capabilityName: 'household_projection', executionLabel: 'Forecast feasibility',
        scenarioId: compiler.cashFlow.scenarioId ?? compiler.investments.scenarioId ?? compiler.liabilities.scenarioId,
        simulationStart: start, simulationEnd: end,
      });
      if (selected.status !== 'compiled' || !selected.value.object) {
        parityFailure = { stage, status: selected.status, diagnosticCounts: diagnosticCounts(selected.diagnostics) };
      } else {
        stage = 'compile source-qualified kernel';
        const runContext = createRunContext({ runId: runId(request.runIdentity), scenarioId: scenarioId(selected.value.id),
          asOf: instant(`${request.asOf}T00:00:00.000Z`), dataCutoff: instant(`${request.dataCutoff}T00:00:00.000Z`),
          simulationStart: startInstant, simulationEnd: instant(endInstant),
          baseCurrency: Currency.of(compiler.cashFlow.baseCurrency) });
        const compiled = compileHouseholdKernelForRun(model, compiler, runContext);
        if (compiled.status !== 'compiled') {
          parityFailure = { stage, status: compiled.status, diagnosticCounts: diagnosticCounts(compiled.diagnostics) };
        } else {
          const { executable, kernel } = compiled.value;
          stage = 'execute optimized summary';
          const summary = runHouseholdKernel({ kernel, runContext });
          stage = 'execute frozen reference';
          const reference = referenceRun({ compiled: executable, runContext });
          stage = 'compare kernel runs';
          referenceEvidence = compareKernelRuns(summary, reference, expected, executable,
            summarizeHouseholdPeriod, canonicalSerialize, createTaxDiagnosticKey());
          if (referenceEvidence.failure) parityFailure = { stage, reason: referenceEvidence.failure };
          if (!referenceEvidence.failure) {
            referenceEquality = referenceEvidence.firstFinancialDifference ? 'different' : 'equal';
          }
        }
      }
    } catch (error) {
      parityFailure = { stage, error: safeErrorNames.has(error?.name) ? error.name : 'Error', message: safeErrorMessage(error?.message),
        ...(Array.isArray(error?.issues) ? { diagnosticCounts: diagnosticCounts(error.issues) } : {}) };
    }
  }
  const evidence = { months, fixture: fixture.id, classification: 'synthetic', status,
    executionError: executionError === true, reachedThrough: reachedThrough ?? null,
    periodCount: applicationCoverage.periodCount, executed, financialCompleteness: status === 'completed',
    applicationCoverage: { ...applicationCoverage, capabilities: applicationCapabilityStatuses },
    wallMs, heapUsedBytes, heapMeaning: 'sampled after forecast, not peak',
    diagnosticCounts: applicationDiagnosticCounts,
    phases: Object.fromEntries(PERFORMANCE_PHASES.map(phase => [phase, registry.latest(phase) ?? 'not measured'])),
    worker: { status: 'not measured', reason: 'existing synthetic fixture executes local_node; worker evidence remains #181-owned' },
    financialEquality: { repeatExecution: equality, optimizedVsReference: referenceEquality,
      scope: 'shared compiled-kernel economics; frozen reference tax-participant coverage and worker transport not measured' },
    referenceEvidence, ...(parityFailure === undefined ? {} : { parityFailure }) };
  writeFileSync(resolve(directory, `${months}.json`), JSON.stringify(evidence, null, 2) + '\n');
  if (!executed || (args[2] === 'manual' && (parityFailure || equality !== 'equal' || referenceEquality !== 'equal'))) process.exitCode = 1;
} else if (invoked) {
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
