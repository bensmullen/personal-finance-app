// Diagnostic-only Vitest reporter for the optional bounded local preflight.
// A completed case is appended immediately. An interrupted file never becomes
// PASS merely because some earlier cases finished. Do not record assertions,
// fixture values, paths to private inputs, or stack traces.
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const progress = process.env.PFM_PREFLIGHT_PROGRESS;
const MAX_EVENTS = 4096;
let events = 0;

function record(phase, testCase, status) {
  if (!progress || events >= MAX_EVENTS) return;
  events += 1;
  // Keep identity stable without writing test/fixture content into diagnostics.
  const id = createHash('sha256').update(String(testCase.id ?? testCase.name ?? '')).digest('hex').slice(0, 16);
  appendFileSync(progress, JSON.stringify({
    phase, id, ...(status === undefined ? {} : { status }),
  }) + '\n');
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
