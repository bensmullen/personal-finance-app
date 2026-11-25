#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { compareLiveShadow, exportLegacy, observeInventory, projectMetadata, shadowReport } from "./goal-issue-metadata.mjs";

const repository = "bensmullen/personal-finance-app";
const endpoint = `https://api.github.com/repos/${repository}/issues`;
const repositoryIdPath = "/repositories/1343958499/issues";
const readBudget = 48 * 1024 * 1024;
const pageSize = 50;
const pageLimit = 80;
const filters = { state: "all", sort: "created", direction: "asc", per_page: String(pageSize) };

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function continuation(header, page, seenCursors) {
  if (header === null) return null;
  // GitHub emits comma-separated <target>; rel="..." entries. A comma inside
  // the angle brackets belongs to the target, including in an opaque cursor.
  const entry = /[ \t]*<([^<>\s#]+)>[ \t]*;[ \t]*rel="(first|prev|next|last)"[ \t]*(,|$)/uy;
  const links = new Map();
  const malformed = `Malformed issue pagination link on page ${page}`;
  const unexpected = `Unexpected issue pagination target on page ${page}`;
  check(header.length > 0 && header.length <= 16_384, malformed);
  while (entry.lastIndex < header.length) {
    const match = entry.exec(header);
    check(match && !links.has(match[2]) && !(match[3] && entry.lastIndex === header.length), malformed);
    const [, target, relation] = match;
    const [, path, query] = /^https:\/\/api\.github\.com(\/[^?]*)(?:\?(.*))?$/iu.exec(target) ?? [];
    check((path === `/repos/${repository}/issues` || path === repositoryIdPath)
      && !/[\\\p{Cc}]|%(?![a-f0-9]{2})/iu.test(target), unexpected);
    const params = new URLSearchParams(query === undefined ? "" : `?${query}`);
    for (const [key, value] of params) {
      check(params.getAll(key).length === 1, unexpected);
      if (Object.hasOwn(filters, key)) {
        check(key === "per_page" ? /^\d+$/u.test(value) && Number(value) === pageSize : value === filters[key], unexpected);
      } else {
        check(["page", "after", "before", "cursor"].includes(key), unexpected);
      }
    }
    const number = params.get("page");
    if (number !== null) {
      check(/^\d+$/u.test(number) && Number.isSafeInteger(Number(number)) && Number(number) > 0, unexpected);
      if (relation === "first") check(Number(number) === 1, unexpected);
      if (relation === "prev") check(Number(number) === page - 1, unexpected);
    }
    links.set(relation, params);
  }
  const next = links.get("next");
  const lastPage = links.get("last")?.get("page") ?? null;
  if (lastPage !== null) {
    check((Number(lastPage) > page) === Boolean(next), unexpected);
  }
  if (!next) return null;
  const number = next.get("page");
  const cursors = [next.get("after"), next.get("cursor")].filter(value => value !== null);
  check(!next.has("before") && cursors.length <= 1 && (number !== null || cursors.length === 1), unexpected);
  if (number !== null) check(Number(number) === page + 1, unexpected);
  const [cursor] = cursors;
  if (cursor === undefined) return "next_numbered";
  check(cursor.length > 0 && !/[\s\p{Cc}\uFFFD]/u.test(cursor) && !seenCursors.has(cursor), unexpected);
  seenCursors.add(cursor);
  return "next_cursor";
}

export async function readIssueInventory({ token, request = fetch }) {
  check(typeof token === "string" && token.length > 0, "GitHub issues:read token required");
  const deadline = AbortSignal.timeout(95_000);
  const issues = [];
  const pages = [];
  const seenCursors = new Set();
  let remainingBytes = readBudget;
  let lastNumber = 0;
  let terminalProbe = false;
  for (let page = 1; page <= pageLimit; page++) {
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(8_000)]);
    const checkTime = () => check(!signal.aborted, deadline.aborted ? "Issue inventory deadline" : `Issue page ${page} deadline`);
    checkTime();
    // Link targets are evidence only. Always request the pinned numbered URL.
    const response = await request(`${endpoint}?${new URLSearchParams({ ...filters, page: String(page) })}`, {
      method: "GET", redirect: "error", signal,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    });
    checkTime();
    check(response.ok && response.body, `Unable to read issue page ${page} (HTTP ${response.status})`);
    const chunks = [];
    for await (const chunk of response.body) {
      checkTime();
      remainingBytes -= chunk.byteLength;
      check(remainingBytes >= 0, "Issue inventory byte limit");
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    checkTime();
    check(Array.isArray(data) && data.length <= pageSize, `Malformed issue page ${page}`);
    const next = continuation(response.headers.get("link"), page, seenCursors);
    if (terminalProbe) {
      check(data.length === 0 && !next, `Incomplete issue pagination: page ${page - 1} had no pagination proof`);
    } else if (next) {
      check(data.length === pageSize, `Incomplete issue pagination on page ${page}`);
    } else {
      check(page === 1 || data.length > 0, `Empty issue page ${page} after continuation`);
    }
    for (const item of data) {
      check(Number.isSafeInteger(item?.number) && item.number > lastNumber, `Unordered or duplicate issue on page ${page}`);
      lastNumber = item.number;
      // GitHub returns null for an issue with no body.
      issues.push({ ...item, body: item.body === null ? "" : item.body });
    }
    pages.push({ page, count: data.length, continuation: next ?? (terminalProbe ? "empty_probe"
      : data.length === pageSize ? "probe_required" : "short_terminal") });
    if (!next && data.length < pageSize) {
      const observations = observeInventory(issues, repository);
      const digest = createHash("sha256");
      for (const { number, issue, body_sha256 } of observations.values()) {
        digest.update(JSON.stringify([number, issue.state, body_sha256]) + "\n");
      }
      return { observations, pagination: { pages, provider_count: issues.length, issue_count: observations.size,
        inventory_sha256: digest.digest("hex") } };
    }
    terminalProbe = !next;
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
  const { observations, pagination } = await readIssueInventory({ token: process.env.GITHUB_TOKEN });
  return { ...traceability({ registry, imported, observations }), pagination };
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
