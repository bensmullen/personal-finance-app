import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const git = process.platform === "win32" ? "git.exe" : "git";

const run = (args) => spawnSync(git, args, {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});

const value = (result) => result.status === 0 ? result.stdout.trim() : "";

const args = process.argv.slice(2);
const expectedIndex = args.indexOf("--expected-head");
const expectedHead = expectedIndex >= 0 ? args[expectedIndex + 1] : undefined;
const requireClean = args.includes("--require-clean");

if (expectedIndex >= 0 && (!expectedHead || expectedHead.startsWith("--"))) {
  console.error("STATE_ERROR reason=missing_expected_head");
  process.exit(64);
}

const headResult = run(["rev-parse", "HEAD"]);
const head = value(headResult);
if (!head) {
  console.error("STATE_ERROR reason=not_a_git_repository");
  process.exit(1);
}

const branch = value(run(["symbolic-ref", "--quiet", "--short", "HEAD"])) || "DETACHED";
const upstream = value(run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])) || "none";

let ahead = "na";
let behind = "na";
if (upstream !== "none") {
  const counts = value(run(["rev-list", "--left-right", "--count", `${upstream}...HEAD`]))
    .split(/\s+/)
    .map((entry) => Number.parseInt(entry, 10));
  if (counts.length === 2 && counts.every(Number.isFinite)) {
    [behind, ahead] = counts;
  }
}

const status = value(run(["status", "--porcelain=v1", "--untracked-files=normal"]));
const dirty = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
const receipt = `branch=${branch} head=${head} upstream=${upstream} ahead=${ahead} behind=${behind} dirty=${dirty}`;

if (expectedHead && !head.startsWith(expectedHead)) {
  console.error(`STATE_MISMATCH ${receipt} expected_head=${expectedHead}`);
  process.exit(2);
}

if (requireClean && dirty > 0) {
  console.error(`STATE_DIRTY ${receipt}`);
  process.exit(3);
}

console.log(`STATE ${receipt}`);
