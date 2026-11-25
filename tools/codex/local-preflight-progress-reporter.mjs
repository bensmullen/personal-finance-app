// Diagnostic-only Vitest reporter for the optional bounded local preflight.
// A completed case is appended immediately. An interrupted file never becomes
// PASS merely because some earlier cases finished. Do not record assertions,
// fixture values, paths to private inputs, or stack traces.
import { appendFileSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';

const progress = process.env.PFM_PREFLIGHT_PROGRESS;
const MAX_EVENTS = 4096;
let events = 0;
const overflowStatuses = new Set();

function append(event) {
  appendFileSync(progress, JSON.stringify(event) + '\n', {
    flag: constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_CREAT,
    mode: 0o600,
  });
}

function record(phase, testCase, status) {
  if (!progress) return;
  if (++events > MAX_EVENTS) {
    if (events === MAX_EVENTS + 1) append({ phase: 'case-limit' });
    if (phase === 'end' && ['failed', 'timed_out'].includes(status) && !overflowStatuses.has(status)) {
      overflowStatuses.add(status);
      append({ phase: 'case-overflow-outcome', status });
    }
    return;
  }
  // Keep identity stable without writing test/fixture content into diagnostics.
  const id = createHash('sha256').update(String(testCase.id ?? testCase.name ?? '')).digest('hex').slice(0, 16);
  append({ phase, id, ...(status === undefined ? {} : { status }) });
}

export default class LocalPreflightProgressReporter {
  onTestCaseReady(testCase) {
    record('start', testCase);
  }

  onTestCaseResult(testCase) {
    const result = testCase.result();
    const state = result?.state;
    // Vitest's per-case timeout exits the file nonzero, but must not become an
    // ordinary FAIL eligible for a corrective local rerun. Inspect messages
    // only in-process; never serialize assertion content into progress logs.
    const timedOut = state === 'failed' && (result?.errors ?? []).some(error =>
      /timeout/i.test(String(error?.name ?? '')) ||
      /\b(?:test|hook) timed out\b/i.test(String(error?.message ?? '')));
    record('end', testCase, timedOut ? 'timed_out' :
      ['passed', 'failed', 'skipped', 'todo'].includes(state) ? state : 'incomplete');
  }
}
