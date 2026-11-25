#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareLiveShadow, exportLegacy, observeInventory, projectMetadata, shadowReport } from "./goal-issue-metadata.mjs";

const repository = "bensmullen/personal-finance-app";
const readBudget = 48 * 1024 * 1024;
const pageSize = 50;
const pageLimit = 80;

function check(condition, message) {
  if (!condition) throw new Error(message);
}

export async function readIssueInventory({ token, request = fetch }) {
  check(typeof token === "string" && token.length > 0, "GitHub issues:read token required");
  const deadline = AbortSignal.timeout(95_000);
  const issues = [];
  let remainingBytes = readBudget;
  let lastNumber = 0;
  const urlFor = (page) => `https://api.github.com/repos/${repository}/issues?state=all&sort=created&direction=asc&per_page=${pageSize}&page=${page}`;
  for (let page = 1; page <= pageLimit; page++) {
    const response = await request(urlFor(page), {
      method: "GET", redirect: "error", signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]),
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    check(response.ok && response.body, `Unable to read issue page ${page} (HTTP ${response.status})`);
    const chunks = [];
    for await (const chunk of response.body) {
      remainingBytes -= chunk.byteLength;
      check(remainingBytes >= 0, "Issue inventory byte limit");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    check(Array.isArray(data) && data.length <= pageSize, `Malformed issue page ${page}`);
    for (const item of data) {
      check(Number.isSafeInteger(item?.number) && item.number > lastNumber, `Unordered or duplicate issue on page ${page}`);
      lastNumber = item.number;
      // GitHub returns null for an issue with no body.
      issues.push({ ...item, body: item.body === null ? "" : item.body });
    }
    const next = (response.headers.get("link") ?? "").split(",").filter(link => /rel="next"/u.test(link));
    if (next.length === 0) {
      check(data.length < pageSize, "Full terminal issue page has no pagination proof");
      return observeInventory(issues, repository);
    }
    check(next.length === 1 && data.length === pageSize && page !== pageLimit, "Incomplete issue pagination");
    const target = /^\s*<([^>]+)>;\s*rel="next"\s*$/u.exec(next[0])?.[1];
    const actual = new URL(target ?? "https://invalid.invalid/");
    const expected = new URL(urlFor(page + 1));
    actual.searchParams.sort();
    expected.searchParams.sort();
    const githubIssuePath = actual.pathname === expected.pathname || /^\/repositories\/\d+\/issues$/u.test(actual.pathname);
    check(actual.origin === expected.origin && !actual.username && !actual.password && !actual.hash
      && githubIssuePath && actual.search === expected.search, "Unexpected next issue page");
  }
  throw new Error("Issue pagination limit");
}

export function traceability({ registry, imported, observations, authority = "legacy_register", resolveDecision, admitted }) {
  check(authority === "legacy_register" || authority === "issue_metadata", "Unknown traceability authority");
  if (authority === "issue_metadata") {
    const { registry: generated, tasks } = projectMetadata(imported, observations, resolveDecision, admitted);
    return { status: "LIVE_METADATA_TRACEABILITY_NON_AUTHORIZING", authority,
      snapshot: { generated_at: new Date().toISOString(), origin: imported.repository, registry: generated },
      task_count: tasks.size };
  }
  const report = compareLiveShadow(registry, imported, observations);
  return { ...report, authority, coverage: report.uncovered_open.length === 0 ? "complete" : "incomplete" };
}

async function main() {
  const registry = JSON.parse(readFileSync(new URL("../../docs/development/milestone-issue-register.json", import.meta.url), "utf8"));
  const imported = exportLegacy(registry, repository);
  const [mode = "--live-shadow", ...extra] = process.argv.slice(2);
  check(extra.length === 0, "Unexpected traceability arguments");
  if (mode === "--export") return imported;
  if (mode === "--offline-shadow") return shadowReport(registry, imported);
  check(mode === "--live-shadow", "Only shadow modes are enabled");
  check(process.env.GITHUB_REPOSITORY === repository, "Unexpected GitHub repository");
  return traceability({ registry, imported, observations: await readIssueInventory({ token: process.env.GITHUB_TOKEN }) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await main();
    console.log(JSON.stringify(report, null, 2));
    if (report.coverage === "incomplete") {
      console.error(`Unregistered open GitHub issues: ${report.uncovered_open.map(n => `#${n}`).join(", ")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    // Only emit controlled diagnostics. Provider JSON, issue text and tokens stay private.
    console.error(error instanceof SyntaxError || error instanceof TypeError ? "Invalid or unavailable issue inventory" : error.message);
    process.exitCode = 1;
  }
}
