#!/usr/bin/env node
/** Lightweight live-GitHub traceability check. Runs on new/reopened/edited issues and weekly. */
import { readFileSync } from "node:fs";

const registry = JSON.parse(readFileSync(new URL("../../docs/development/milestone-issue-register.json", import.meta.url), "utf8"));
const registered = new Set([
  ...registry.issues.map(row => row.issue_number),
  ...registry.legacy_open_task_reconciliation.issue_numbers,
]);
const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY is required.");
if (!token) throw new Error("GITHUB_TOKEN with issues:read is required; live issue coverage cannot be skipped.");

const endpoint = process.env.GITHUB_API_URL ?? "https://api.github.com";
const live = [];
for (let page = 1; page <= 100; page++) {
  const url = `${endpoint}/repos/${repository}/issues?state=open&per_page=100&page=${page}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`Unable to verify issue coverage (HTTP ${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("GitHub issue list returned unexpected content.");
  live.push(...data.filter(item => !item.pull_request && !String(item.title ?? "").startsWith("[agent-candidate]")));
  if (data.length < 100) break;
  if (page === 100) throw new Error("Issue pagination limit reached: expand verification rather than silently truncating.");
}
const missing = live.filter(item => !registered.has(item.number));
if (missing.length > 0) {
  console.error("Unregistered open GitHub product/framework issues:");
  for (const item of missing) console.error(`- #${item.number}: ${item.title}`);
  console.error("Assign a milestone, first mandatory gate and dependencies in docs/development/milestone-issue-register.json, or reconcile a historical open issue into the administrative list.");
  process.exitCode = 1;
} else {
  console.log(`Issue traceability verified: ${live.length} live non-learning issues, all registered or awaiting documented legacy administrative reconciliation.`);
}
