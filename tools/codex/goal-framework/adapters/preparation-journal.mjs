import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { types } from 'node:util';
import { canonicalJson, digest } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef } from '../resources.mjs';
import { identifier, readBoundedFile } from '../workspace.mjs';

const schema = 'PFM_PREPARATION_JOURNAL_V1';
const limit = 100;
const maxBytes = 96 * 1024;
const copy = (value) => JSON.parse(canonicalJson(value));
const hash = /^[a-f0-9]{64}$/;
const stateDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function rejectAsyncReply(value) {
  if (types.isPromise(value)) {
    // A rejected asynchronous reply must not escape as an unhandled rejection.
    Promise.prototype.then.call(value, undefined, () => {});
    return true;
  }
  return false;
}

function synchronousData(value) {
  requireResource(!rejectAsyncReply(value), 'PREPARATION_PORT_ASYNC');
  return canonicalJson(value);
}

// Capture the completed callback under the port. The wrapper may serialize
// the reply, but it cannot replace it or suppress a callback failure.
export function synchronousPreparationCallback(invoke, action, boundary, noResult = false) {
  let open = true;
  let invoked = false;
  let replayed = false;
  let failure;
  let wrapperFailure;
  let completed;
  const encode = (value) => noResult && value === undefined ? undefined : synchronousData(value);
  let response;
  try {
    response = invoke((proof) => {
      requireResource(open, boundary + '_REPLAY');
      if (invoked) {
        replayed = true;
        throw new Error(boundary + '_REPLAY');
      }
      invoked = true;
      try {
        completed = encode(action(JSON.parse(synchronousData(proof))));
        return completed === undefined ? undefined : JSON.parse(completed);
      } catch (error) {
        failure = { error };
        throw error;
      }
    });
  } catch (error) {
    wrapperFailure = { error };
  } finally {
    open = false;
  }
  const asynchronous = rejectAsyncReply(response);
  if (failure) throw failure.error;
  requireResource(!replayed, boundary + '_REPLAY');
  if (wrapperFailure) throw wrapperFailure.error;
  requireResource(!asynchronous, 'PREPARATION_PORT_ASYNC');
  requireResource(invoked, boundary + '_UNAVAILABLE');
  const returned = encode(response);
  requireResource(returned === completed, boundary + '_RESULT');
  return completed === undefined ? undefined : JSON.parse(completed);
}

// The installed supervisor owns the directory, key and OS-backed lock port.
// The outer capacity gate also excludes native writers and other host effects.
// Never rotate away tombstones or initialize over surviving staging evidence.
export function openPreparationJournal({ directory, hostId, key, withLock, currentState, verify, initialize = false, fault }) {
  const info = lstatSync(directory);
  requireResource(info.isDirectory() && realpathSync(directory) === directory
    && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700
    && typeof hostId === 'string' && identifier.test(hostId)
    && Buffer.isBuffer(key) && key.length === 32 && typeof withLock === 'function'
    && typeof currentState?.read === 'function' && typeof currentState?.commit === 'function', 'PREPARATION_JOURNAL_HOST');
  resourceAttest(verify, 'preparation_private_journal', { directory, hostId });
  const secret = Buffer.from(key);
  const path = join(directory, 'preparations.json');
  const staging = join(directory, 'preparations.next');
  const exists = (file) => lstatSync(file, { throwIfNoEntry: false }) !== undefined;
  const sign = (state) => createHmac('sha256', secret).update(canonicalJson(state, maxBytes)).digest();
  const identity = { directory, host_id: hostId };

  function witness(lockProof) {
    const current = JSON.parse(synchronousData(currentState.read(copy(identity), copy(lockProof))));
    requireResource(current === null || (current && Object.keys(current).length === 2
      && Number.isSafeInteger(current.generation) && current.generation > 0
      && typeof current.digest === 'string' && hash.test(current.digest)), 'PREPARATION_JOURNAL_WITNESS');
    resourceAttest(verify, 'preparation_journal_current', { identity, lock: lockProof, current });
    return current;
  }

  function store(state, previous, lockProof) {
    state.generation = (previous?.generation ?? 0) + 1;
    requireResource(Number.isSafeInteger(state.generation), 'PREPARATION_JOURNAL_WITNESS');
    const data = canonicalJson({ state, mac: sign(state).toString('hex') }, maxBytes);
    const next = { generation: state.generation, digest: stateDigest(data) };
    const folder = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        writeFileSync(fd, data);
        fault?.('after-write');
        fsyncSync(fd);
        fault?.('after-file-sync');
      } finally {
        closeSync(fd);
      }
      renameSync(staging, path);
      fault?.('after-rename');
      fsyncSync(folder);
      fault?.('after-directory-sync');
    } finally {
      closeSync(folder);
    }
    // The independent host advances its durable witness only after both syncs.
    // A visible rename with an unadvanced witness is an unknown disposition.
    const acknowledgement = currentState.commit(copy(identity), copy(previous), copy(next), copy(lockProof));
    if (acknowledgement !== undefined) {
      synchronousData(acknowledgement);
      throw new Error('PREPARATION_JOURNAL_COMMIT_UNKNOWN');
    }
    requireResource(digest(witness(lockProof)) === digest(next), 'PREPARATION_JOURNAL_COMMIT_UNKNOWN');
  }

  function load(lockProof) {
    const bytes = readBoundedFile(path, maxBytes).toString('utf8');
    const record = JSON.parse(bytes);
    const { state, mac } = record;
    requireResource(canonicalJson(record, maxBytes) === bytes && Object.keys(record).length === 2
      && typeof mac === 'string' && hash.test(mac) && timingSafeEqual(sign(state), Buffer.from(mac, 'hex'))
      && state.schema === schema && state.host_id === hostId && Array.isArray(state.records)
      && Number.isSafeInteger(state.generation) && state.generation > 0
      && state.records.length <= limit, 'PREPARATION_JOURNAL_STATE');
    const current = witness(lockProof);
    requireResource(current?.generation === state.generation && current.digest === stateDigest(bytes),
      'PREPARATION_JOURNAL_COMMIT_UNKNOWN');
    return { state, current };
  }

  function locked(operation, noResult) {
    return synchronousPreparationCallback((callback) => withLock(directory, callback), (lock) => {
      resourceRef(lock);
      resourceAttest(verify, 'preparation_journal_lock', { directory, hostId, lock });
      return operation(lock);
    }, 'PREPARATION_JOURNAL_LOCK', noResult);
  }

  locked((lock) => {
    if (initialize) {
      requireResource(!exists(path) && !exists(staging) && witness(lock) === null, 'PREPARATION_JOURNAL_EXISTS');
      store({ schema, host_id: hostId, records: [] }, null, lock);
    }
    load(lock);
  }, true);

  function find(state, binding) {
    requireResource(binding.host_id === hostId && typeof binding.id === 'string' && identifier.test(binding.id)
      && ['nonce_digest', 'request_digest', 'approval_digest', 'resource_digest']
        .every((field) => typeof binding[field] === 'string' && hash.test(binding[field])), 'PREPARATION_JOURNAL_BINDING');
    resourceRef(binding.allowance);
    const record = state.records.find((entry) => entry.id === binding.id || entry.nonce_digest === binding.nonce_digest);
    if (record) requireResource(record.id === binding.id && record.nonce_digest === binding.nonce_digest
      && record.request_digest === binding.request_digest && record.approval_digest === binding.approval_digest
      && record.resource_digest === binding.resource_digest && digest(record.allowance) === digest(binding.allowance),
    'PREPARATION_REQUEST_CONFLICT');
    return record;
  }

  return Object.freeze({
    observe(binding) {
      return locked((lock) => {
        const intent = find(load(lock).state, binding);
        requireResource(intent?.status !== 'git-ready' || !exists(staging), 'PREPARATION_JOURNAL_RECOVERY');
        return copy(intent ?? null);
      });
    },
    begin(binding, gate) {
      return locked((lock) => {
        const { state, current } = load(lock);
        const previous = find(state, binding);
        if (previous && previous.status !== 'git-ready') return { created: false, intent: copy(previous) };
        requireResource(!exists(staging), 'PREPARATION_JOURNAL_RECOVERY');
        if (previous) return { created: false, intent: copy(previous) };
        requireResource(state.records.length < limit && !state.records.some((entry) => entry.status === 'unresolved'),
          'PREPARATION_CAPACITY_UNAVAILABLE');
        const intent = { schema: 'PFM_PREPARATION_INTENT_V1', id: binding.id, nonce_digest: binding.nonce_digest,
          request_digest: binding.request_digest, approval_digest: binding.approval_digest,
          allowance: binding.allowance, host_id: hostId,
          resource_digest: binding.resource_digest, effect_id: digest(['bootstrap', hostId, binding.request_digest]),
          status: 'unresolved', evidence: null, reconciliation_reads: 0 };
        resourceAttest(verify, 'preparation_begin_fenced', { intent, gate });
        state.records.push(intent);
        store(state, current, lock);
        return { created: true, intent: copy(intent) };
      });
    },
    reserveRead(binding, gate) {
      return locked((lock) => {
        const { state, current } = load(lock);
        const intent = find(state, binding);
        if (intent?.status !== 'unresolved' || intent.reconciliation_reads >= 4 || exists(staging)) return false;
        resourceAttest(verify, 'preparation_reconciliation_read', { intent, gate });
        intent.reconciliation_reads++;
        store(state, current, lock);
        return true;
      });
    },
    finish(binding, status, evidence, gate) {
      return locked((lock) => {
        const { state, current } = load(lock);
        const intent = find(state, binding);
        requireResource(!exists(staging), 'PREPARATION_JOURNAL_RECOVERY');
        requireResource(intent?.status === 'unresolved' && ['nonstart', 'cleaned', 'git-ready'].includes(status),
          'PREPARATION_DISPOSITION');
        resourceRef(evidence);
        resourceAttest(verify, 'preparation_capacity_release', { intent, status, evidence, gate });
        Object.assign(intent, { status, evidence });
        store(state, current, lock);
        return copy(intent);
      });
    },
  });
}
