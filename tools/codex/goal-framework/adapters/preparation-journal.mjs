import { createHmac, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, openSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, digest } from '../contracts.mjs';
import { requireResource, resourceAttest, resourceRef } from '../resources.mjs';
import { identifier, readBoundedFile } from '../workspace.mjs';

const schema = 'PFM_PREPARATION_JOURNAL_V1';
const limit = 100;
const maxBytes = 96 * 1024;
const copy = (value) => JSON.parse(canonicalJson(value));
const hash = /^[a-f0-9]{64}$/;

// The installed supervisor owns the directory, key and OS-backed lock port.
// The outer capacity gate also excludes native writers and other host effects.
// Never rotate away tombstones or initialize over surviving staging evidence.
export function openPreparationJournal({ directory, hostId, key, withLock, verify, initialize = false }) {
  const info = lstatSync(directory);
  requireResource(info.isDirectory() && realpathSync(directory) === directory
    && info.uid === process.getuid?.() && (info.mode & 0o777) === 0o700
    && typeof hostId === 'string' && identifier.test(hostId)
    && Buffer.isBuffer(key) && key.length === 32 && typeof withLock === 'function', 'PREPARATION_JOURNAL_HOST');
  resourceAttest(verify, 'preparation_private_journal', { directory, hostId });
  const secret = Buffer.from(key);
  const path = join(directory, 'preparations.json');
  const staging = join(directory, 'preparations.next');
  const exists = (file) => lstatSync(file, { throwIfNoEntry: false }) !== undefined;
  const sign = (state) => createHmac('sha256', secret).update(canonicalJson(state, maxBytes)).digest();

  function store(state) {
    const data = canonicalJson({ state, mac: sign(state).toString('hex') }, maxBytes);
    const folder = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        writeFileSync(fd, data);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(staging, path);
      fsyncSync(folder);
    } finally {
      closeSync(folder);
    }
  }

  function load() {
    const bytes = readBoundedFile(path, maxBytes).toString('utf8');
    const record = JSON.parse(bytes);
    const { state, mac } = record;
    requireResource(canonicalJson(record, maxBytes) === bytes && Object.keys(record).length === 2
      && typeof mac === 'string' && hash.test(mac) && timingSafeEqual(sign(state), Buffer.from(mac, 'hex'))
      && state.schema === schema && state.host_id === hostId && Array.isArray(state.records)
      && state.records.length <= limit, 'PREPARATION_JOURNAL_STATE');
    return state;
  }

  function locked(operation) {
    let invoked = false;
    let open = true;
    try {
      const result = withLock(directory, (lock) => {
        requireResource(open && !invoked, 'PREPARATION_JOURNAL_LOCK_REPLAY');
        invoked = true;
        resourceRef(lock);
        resourceAttest(verify, 'preparation_journal_lock', { directory, hostId, lock });
        return operation();
      });
      requireResource(invoked, 'PREPARATION_JOURNAL_LOCK');
      return result;
    } finally {
      open = false;
    }
  }

  locked(() => {
    if (initialize) {
      requireResource(!exists(path) && !exists(staging), 'PREPARATION_JOURNAL_EXISTS');
      store({ schema, host_id: hostId, records: [] });
    }
    load();
  });

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
      return locked(() => copy(find(load(), binding) ?? null));
    },
    begin(binding, gate) {
      return locked(() => {
        const state = load();
        const previous = find(state, binding);
        if (previous) return { created: false, intent: copy(previous) };
        requireResource(!exists(staging), 'PREPARATION_JOURNAL_RECOVERY');
        requireResource(state.records.length < limit && !state.records.some((entry) => entry.status === 'unresolved'),
          'PREPARATION_CAPACITY_UNAVAILABLE');
        const intent = { schema: 'PFM_PREPARATION_INTENT_V1', id: binding.id, nonce_digest: binding.nonce_digest,
          request_digest: binding.request_digest, approval_digest: binding.approval_digest,
          allowance: binding.allowance, host_id: hostId,
          resource_digest: binding.resource_digest, effect_id: digest(['bootstrap', hostId, binding.request_digest]),
          status: 'unresolved', evidence: null, reconciliation_reads: 0 };
        resourceAttest(verify, 'preparation_begin_fenced', { intent, gate });
        state.records.push(intent);
        store(state);
        return { created: true, intent: copy(intent) };
      });
    },
    reserveRead(binding, gate) {
      return locked(() => {
        const state = load();
        const intent = find(state, binding);
        if (intent?.status !== 'unresolved' || intent.reconciliation_reads >= 4 || exists(staging)) return false;
        resourceAttest(verify, 'preparation_reconciliation_read', { intent, gate });
        intent.reconciliation_reads++;
        store(state);
        return true;
      });
    },
    finish(binding, status, evidence, gate) {
      return locked(() => {
        const state = load();
        const intent = find(state, binding);
        requireResource(!exists(staging), 'PREPARATION_JOURNAL_RECOVERY');
        requireResource(intent?.status === 'unresolved' && ['nonstart', 'cleaned', 'git-ready'].includes(status),
          'PREPARATION_DISPOSITION');
        resourceRef(evidence);
        resourceAttest(verify, 'preparation_capacity_release', { intent, status, evidence, gate });
        Object.assign(intent, { status, evidence });
        store(state);
        return copy(intent);
      });
    },
  });
}
