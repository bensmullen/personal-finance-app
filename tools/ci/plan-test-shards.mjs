import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function validatePartition(inventory, shards) {
  const expected = inventory.map(t => t.id).sort(compare);
  const actual = shards.flat().map(t => t.id).sort(compare);
  if (!expected.length || new Set(expected).size !== expected.length ||
      actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
    throw new Error('Inventory/assignment mismatch, empty inventory or duplicate identity');
  }
  for (const item of inventory) {
    if (typeof item.id !== 'string' || !item.id || /[\r\n]/u.test(item.id)) throw new Error('Invalid test identity');
  }
  const owners = new Map();
  const identities = new Map(inventory.map(test => [test.id, test]));
  shards.forEach((tests, index) => tests.forEach(t => {
    if (identities.get(t.id)?.group !== t.group) throw new Error('Assignment changed serial identity metadata');
    if (t.group && owners.has(t.group) && owners.get(t.group) !== index) throw new Error('Split serial group');
    if (t.group) owners.set(t.group, index);
  }));
}

export function partition(inventory, count, baseline = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Invalid shard count');
  const fallback = baseline.unknownMs;
  if (!Number.isFinite(fallback) || fallback <= 0) throw new Error('Invalid unknown duration');
  const durations = baseline.durations ?? {};
  for (const value of Object.values(durations)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid baseline duration');
  }
  const groups = new Map();
  for (const test of inventory) {
    const key = test.group ? `group:${test.group}` : `test:${test.id}`;
    const group = groups.get(key) ?? { key, tests: [], cost: 0 };
    group.tests.push(test);
    group.cost += Object.hasOwn(durations, test.id) ? durations[test.id] : fallback;
    groups.set(key, group);
  }
  const shards = Array.from({ length: count }, () => []);
  const loads = Array(count).fill(0);
  for (const group of [...groups.values()].sort((a, b) => b.cost - a.cost || compare(a.key, b.key))) {
    const target = loads.indexOf(Math.min(...loads));
    shards[target].push(...group.tests);
    loads[target] += group.cost;
  }
  shards.forEach(tests => tests.sort((a, b) => compare(a.id, b.id)));
  validatePartition(inventory, shards);
  return { shards, estimatedMs: loads };
}

function command(args, env = {}) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8',
    env: { ...process.env, ...env }, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error || result.signal) throw new Error(`Discovery failed: ${result.stderr || result.error || result.signal}`);
  return result.stdout;
}

export function discover(kind, directory) {
  if (kind === 'unit') {
    const files = JSON.parse(command(['node_modules/vitest/vitest.mjs', 'list', '--filesOnly', '--json']));
    if (!Array.isArray(files) || files.some(file => typeof file !== 'string')) throw new Error('Invalid Vitest discovery');
    const trackedResult = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
    if (trackedResult.status !== 0) throw new Error('Cannot read tracked inventory');
    const tracked = new Set(trackedResult.stdout.split('\0'));
    return files.map(file => {
      const id = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
      if (!tracked.has(id)) throw new Error(`Untracked discovered test: ${id}`);
      return { id };
    });
  }
  if (kind !== 'e2e') throw new Error('Unknown suite');
  const destination = path.join(directory, 'discovery.json');
  command(['node_modules/@playwright/test/cli.js', 'test', '--list',
    '--reporter=./tools/ci/collect-test-durations.mjs'], { PFM_DISCOVERY: destination });
  return JSON.parse(readFileSync(destination, 'utf8'));
}

export function plan(kind, count, directory) {
  mkdirSync(directory, { recursive: true });
  const inventory = discover(kind, directory);
  const baseline = JSON.parse(readFileSync(path.join(root, 'tools/ci/test-duration-baseline.json'), 'utf8'));
  const result = partition(inventory, count, baseline[kind]);
  const proof = { schema: 1, sha: process.env.GITHUB_SHA ?? null, kind, count,
    inventory, ...result };
  writeFileSync(path.join(directory, 'assignment.json'), JSON.stringify(proof, null, 2));
  console.log(`Inventory ${kind}: ${inventory.length}; shards=${result.shards.map(s => s.length).join(',')}; union/dedup verified`);
  return proof;
}

export function selectAssignment(proof, index, kind, count) {
  if (proof.kind !== kind || proof.count !== count || proof.shards.length !== count ||
      !Number.isInteger(index) || index < 1 || index > count ||
      (process.env.GITHUB_SHA && proof.sha !== process.env.GITHUB_SHA)) throw new Error('Invalid/stale assignment');
  validatePartition(proof.inventory, proof.shards);
  const selected = proof.shards[index - 1];
  if (!selected.length) throw new Error('Selected shard is empty');
  return selected;
}
