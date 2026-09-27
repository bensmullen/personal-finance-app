import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const logsDirectory = path.join(root, ".codex", "logs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(logsDirectory, `playwright-${stamp}.json`);
const rawLogPath = path.join(logsDirectory, `playwright-${stamp}.log`);
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const maxFailureOutput = 8 * 1024;

await mkdir(logsDirectory, { recursive: true });

const result = spawnSync(
  npx,
  ["playwright", "test", ...process.argv.slice(2), "--reporter=json"],
  {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 40 * 1024 * 1024,
  },
);

const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
await writeFile(rawLogPath, rawOutput, "utf8");
await writeFile(reportPath, result.stdout || "", "utf8");

const clip = (value, limit = maxFailureOutput) => {
  const text = String(value ?? "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… output clipped …`;
};

let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch {
  report = undefined;
}

const tests = [];
const walk = (suite, titles = []) => {
  const nextTitles = suite?.title ? [...titles, suite.title] : titles;
  for (const spec of suite?.specs ?? []) {
    for (const test of spec.tests ?? []) {
      tests.push({
        title: [...nextTitles, spec.title, test.title].filter(Boolean).join(" › "),
        test,
      });
    }
  }
  for (const child of suite?.suites ?? []) walk(child, nextTitles);
};
for (const suite of report?.suites ?? []) walk(suite);

if (result.status === 0) {
  console.log(`PASS playwright — ${tests.length} tests`);
  await Promise.all([
    rm(reportPath, { force: true }),
    rm(rawLogPath, { force: true }),
  ]);
  process.exit(0);
}

const failures = [];
for (const entry of tests) {
  const badResult = [...(entry.test.results ?? [])].reverse().find((item) =>
    !["passed", "skipped"].includes(item.status)
  );
  if (!badResult) continue;
  const message = badResult.error?.message
    ?? badResult.errors?.[0]?.message
    ?? badResult.error?.stack
    ?? "Playwright test failed.";
  failures.push(`${entry.title || "failed test"}\n${message}`);
}
for (const error of report?.errors ?? []) {
  failures.push(error.message ?? error.stack ?? String(error));
}

console.error(`FAIL playwright — ${failures.length || "unknown"} reported failures / ${tests.length || "unknown"} tests`);
if (failures.length > 0) {
  const selected = failures.slice(0, 10).map((block, index) => {
    const lines = block.split(/\r?\n/).slice(0, 22).join("\n");
    return `${index + 1}. ${lines}`;
  }).join("\n\n");
  console.error(clip(selected));
  if (failures.length > 10) console.error(`Showing first 10 of ${failures.length} reported failures.`);
} else {
  console.error(clip(rawOutput || result.error?.stack || result.error?.message || "Playwright failed without a parseable report."));
}

console.error(`Full report: ${path.relative(root, reportPath)}`);
console.error(`Full log: ${path.relative(root, rawLogPath)}`);
process.exitCode = result.status || 1;
