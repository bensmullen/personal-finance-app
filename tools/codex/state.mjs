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
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const expectedHead = argValue("--expected-head");
const targetBranch = argValue("--target-branch");
const taskContinuity = argValue("--task-continuity");
const requireClean = args.includes("--require-clean");
const requireLinkedWorktree = args.includes("--require-linked-worktree");

for (const [flag, valueToCheck] of [
  ["--expected-head", expectedHead],
  ["--target-branch", targetBranch],
  ["--task-continuity", taskContinuity],
]) {
  const index = args.indexOf(flag);
  if (index >= 0 && (!valueToCheck || valueToCheck.startsWith("--"))) {
    console.error(`STATE_ERROR reason=missing_value flag=${flag}`);
    process.exit(64);
  }
}
if (taskContinuity && !["new_pr", "existing_pr"].includes(taskContinuity)) {
  console.error("STATE_ERROR reason=invalid_task_continuity");
  process.exit(64);
}

const head = value(run(["rev-parse", "HEAD"]));
if (!head) {
  console.error("STATE_ERROR reason=not_a_git_repository");
  process.exit(1);
}
const branch = value(run(["symbolic-ref", "--quiet", "--short", "HEAD"])) || "DETACHED";
const upstream = value(run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])) || "none";
const gitDirRaw = value(run(["rev-parse", "--git-dir"]));
const commonDirRaw = value(run(["rev-parse", "--git-common-dir"]));
const absoluteGitPath = (raw) => path.resolve(root, raw);
const linkedWorktree = Boolean(gitDirRaw && commonDirRaw && absoluteGitPath(gitDirRaw) !== absoluteGitPath(commonDirRaw));

const worktreeResult = run(["worktree", "list", "--porcelain"]);
let activeWorktree = "";
let targetOwner = "";
if (worktreeResult.status === 0) {
  let currentPath = "";
  for (const line of worktreeResult.stdout.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) currentPath = line.slice("worktree ".length);
    if (line === `branch refs/heads/${branch}`) activeWorktree = currentPath;
    if (targetBranch && line === `branch refs/heads/${targetBranch}`) targetOwner = currentPath;
  }
}

let ahead = "na";
let behind = "na";
if (upstream !== "none") {
  const counts = value(run(["rev-list", "--left-right", "--count", `${upstream}...HEAD`]))
    .split(/\s+/)
    .map((entry) => Number.parseInt(entry, 10));
  if (counts.length === 2 && counts.every(Number.isFinite)) [behind, ahead] = counts;
}
const status = value(run(["status", "--porcelain=v1", "--untracked-files=normal"]));
const dirty = status ? status.split(/\r?\n/).filter(Boolean).length : 0;
const receipt = `branch=${branch} head=${head} upstream=${upstream} ahead=${ahead} behind=${behind} dirty=${dirty} linked_worktree=${linkedWorktree ? "yes" : "no"} active_worktree=${activeWorktree || "unknown"} target_owner=${targetOwner || "none"}`;

if (expectedHead && head !== expectedHead) {
  console.error(`STATE_MISMATCH ${receipt} expected_head=${expectedHead}`);
  process.exit(2);
}
if (requireClean && dirty > 0) {
  console.error(`STATE_DIRTY ${receipt}`);
  process.exit(3);
}
if (taskContinuity === "existing_pr" && targetBranch && branch !== targetBranch) {
  console.error(`STATE_BRANCH_MISMATCH ${receipt} target_branch=${targetBranch}`);
  process.exit(4);
}
if (requireLinkedWorktree && !linkedWorktree) {
  console.error(`STATE_WORKTREE_REQUIRED ${receipt}`);
  process.exit(5);
}
console.log(`STATE ${receipt}`);
