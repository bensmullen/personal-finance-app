import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps the approved goal plan mapped and rejects unsafe allocation and contract fixtures", () => {
  const script = fileURLToPath(new URL("../tools/codex/verify-goal-framework-plan.py", import.meta.url));
  const result = spawnSync("python3", [script, "--self-test"], { encoding: "utf8", timeout: 10_000, maxBuffer: 128 * 1024 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  const report = JSON.parse(result.stdout) as {
    status: string;
    work_packages: number;
    requirements: number;
    self_test: { positive: number; negative: number };
  };
  expect(report.status).toBe("PLAN_VALID_NOT_IMPLEMENTED");
  expect(report.work_packages).toBe(9);
  expect(report.requirements).toBe(24);
  expect(report.self_test).toEqual({ positive: 3, negative: 46 });
});
