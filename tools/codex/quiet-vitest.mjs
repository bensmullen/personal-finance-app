import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "../..");
const logsDirectory = path.join(root, ".codex", "logs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = path.join(logsDirectory, `vitest-${stamp}.json`);
const rawLogPath = path.join(logsDirectory, `vitest-${stamp}.log`);
const vitestPath = path.join(root, "node_modules", "vitest", "vitest.mjs");
const maxFailureOutput = 8 * 1024;

await mkdir(logsDirectory, { recursive: true });

const result = spawnSync(
  process.execPath,
  [
    vitestPath,
    "run",
    ...process.argv.slice(2),
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  },
);

const rawOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
await writeFile(rawLogPath, rawOutput, "utf8");

const relative = (value) => {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  const fromRoot = path.relative(root, value);
  return fromRoot && !fromRoot.startsWith("..") ? fromRoot : value;
};

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

if (result.status === 0 && report?.success === true) {
  const total = report.numTotalTests ?? 0;
  const passed = report.numPassedTests ?? total;
  const files = Array.isArray(report.testResults)
    ? report.testResults.length
    : report.numTotalTestSuites ?? 0;
  console.log(`PASS vitest — ${passed}/${total} tests / ${files} files`);
  await Promise.all([
    rm(reportPath, { force: true }),
    rm(rawLogPath, { force: true }),
  ]);
  process.exit(0);
}

const total = report?.numTotalTests ?? 0;
const failed = report?.numFailedTests ?? "unknown";
console.error(`FAIL vitest — ${failed} failed / ${total || "unknown"}`);

const failureBlocks = [];
for (const testResult of report?.testResults ?? []) {
  for (const assertion of testResult.assertionResults ?? []) {
    if (assertion.status !== "failed") continue;
    const messages = Array.isArray(assertion.failureMessages)
      ? assertion.failureMessages.join("\n")
      : "";
    failureBlocks.push(
      `${relative(testResult.name)}\n${assertion.fullName || assertion.title || "failed test"}\n${messages}`,
    );
  }

  if (
    testResult.status === "failed"
    && (testResult.assertionResults?.filter((item) => item.status === "failed").length ?? 0) === 0
    && testResult.message
  ) {
    failureBlocks.push(`${relative(testResult.name)}\n${testResult.message}`);
  }
}

const selected = failureBlocks.slice(0, 10).map((block, index) => {
  const lines = block.split(/\r?\n/).slice(0, 22).join("\n");
  return `${index + 1}. ${lines}`;
}).join("\n\n");

if (selected) {
  console.error(clip(selected));
  if (failureBlocks.length > 10) {
    console.error(`Showing first 10 of ${failureBlocks.length} reported failures.`);
  }
} else {
  const fallback = rawOutput || result.error?.stack || result.error?.message || "Vitest failed without a parseable report.";
  console.error(clip(fallback));
}

console.error(`Full report: ${path.relative(root, reportPath)}`);
console.error(`Full log: ${path.relative(root, rawLogPath)}`);
process.exitCode = 1;
