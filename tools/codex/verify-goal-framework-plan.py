#!/usr/bin/env python3
"""Read-only plan integrity and optional saved-issue syntax checks; never dispatches."""
import argparse
import ast
import copy
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/development/goal-framework"
REPOSITORY = "bensmullen/personal-finance-app"


def check(plan, registry):
    errors = []
    def require(ok, message):
        if not ok:
            errors.append(message)
    require(plan.get("schema_version") == 1, "unsupported plan version")
    require(plan.get("repository") == REPOSITORY, "wrong repository")
    required = {f"GF-R{i:02}" for i in range(1, 25)}
    require(set(plan["requirements"]) == required and len(plan["requirements"]) == 24, "requirement inventory")
    packages = plan["work_packages"]
    by_issue = {w["issue"]: w for w in packages}
    require(len(by_issue) == len(packages) == 9, "duplicate/missing work package issue")
    require(len({w["id"] for w in packages}) == 9, "duplicate work package ID")
    require(len(set(plan["metrics"])) == len(plan["metrics"]) == 10, "metric inventory")
    require(set(plan["metrics"]) == {f"GF-M{i:02}" for i in range(1, 11)}, "unknown metric")
    cases = {v["id"]: v["requirement"] for v in plan["verification"]}
    require(len(cases) == len(plan["verification"]) == 24, "verification inventory")
    require(cases == {f"GF-V{i:02}": f"GF-R{i:02}" for i in range(1, 25)}, "verification mapping")
    phases = {p["id"]: p for p in plan["phases"]}
    require(set(phases) == {"P1", "P2", "P3", "P4"} and len(plan["phases"]) == 4, "phase inventory")
    rows = {r["issue_number"]: r for r in registry["issues"]}
    require(len(rows) == len(registry["issues"]), "duplicate register issue")
    require(plan["goal_issue"] in rows, "goal unregistered")
    covered = set()
    for w in packages:
        require(w["phase"] in phases, "unknown phase")
        require(set(w["requirements"]) <= required and bool(w["requirements"]), "unknown/empty requirement")
        covered.update(w["requirements"])
        require(set(w["verification"]) <= set(cases), "unknown verification case")
        require({cases.get(v) for v in w["verification"]} == set(w["requirements"]), "task verification gap")
        require(w["dependency_policy"] in {"locked", "manifest_edit"}, "dependency policy")
        require(bool(re.fullmatch(r"codex/[A-Za-z0-9._/-]+", w["branch"])), "invalid target branch")
        require(set(w["depends_on"]) <= set(by_issue), "unknown dependency")
        require(w["issue"] not in w["depends_on"], "self dependency")
        row = rows.get(w["issue"], {})
        require(row.get("blocking_gate") == "GOAL_FRAMEWORK_" + w["phase"], "register gate mismatch")
        require(row.get("depends_on") == w["depends_on"], "register dependency mismatch")
        require(row.get("spec_requirement_ids") == w["requirements"], "register requirement mismatch")
    require(covered == required, "unowned requirement")
    for p in plan["phases"]:
        expected = {w["issue"] for w in packages if w["phase"] == p["id"]}
        require(set(p["issues"]) == expected and len(p["issues"]) == len(expected), "phase allocation")
        gate = registry["stage_gates"].get(p["gate"], {})
        expected_rows = expected | ({plan["goal_issue"]} if p["id"] == "P4" else set())
        require(set(gate.get("required_issue_numbers", [])) == expected_rows, "register phase allocation")
        require(bool(p["exit"].strip()), "missing exit criterion")
    active, complete = set(), set()
    def visit(number):
        if number in active:
            errors.append("dependency cycle")
            return
        if number in complete or number not in by_issue:
            return
        active.add(number)
        for dependency in by_issue[number]["depends_on"]:
            visit(dependency)
        active.remove(number)
        complete.add(number)
    for number in by_issue:
        visit(number)
    return errors


def self_test(plan, registry):
    assert not check(plan, registry), "valid plan rejected"
    mutations = [
        lambda p, r: p.update(schema_version=99),
        lambda p, r: p["requirements"].pop(),
        lambda p, r: p["work_packages"].append(copy.deepcopy(p["work_packages"][0])),
        lambda p, r: p["work_packages"][0]["depends_on"].append(p["work_packages"][-1]["issue"]),
        lambda p, r: p["work_packages"][0]["verification"].clear(),
        lambda p, r: p["verification"][0].update(requirement="GF-R99"),
        lambda p, r: p["phases"][0]["issues"].clear(),
        lambda p, r: r["stage_gates"]["GOAL_FRAMEWORK_P1"]["required_issue_numbers"].clear(),
        lambda p, r: p["work_packages"][0]["depends_on"].append(999999),
        lambda p, r: p["metrics"].append(p["metrics"][0]),
    ]
    for mutation in mutations:
        p, r = copy.deepcopy(plan), copy.deepcopy(registry)
        mutation(p, r)
        assert check(p, r), "invalid plan accepted"
    return {"positive": 1, "negative": len(mutations)}


def hook_parser():
    """Compile actual parser definitions without running lifecycle/tool hooks."""
    path = ROOT / ".codex/hooks/pfm-policy.py"
    source = path.read_text()
    constants = {"APPROVED_BRANCH_PREFIXES", "CONTROL_PATHS", "REQUIRED_SCALARS", "REQUIRED_SECTIONS"}
    functions = {"scalar", "section", "list_section", "normalize", "is_control_path", "validate_task"}
    nodes = []
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in constants for t in node.targets):
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in functions:
            nodes.append(node)
    namespace = {"re": re, "fnmatch": fnmatch}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), namespace)
    if not all(name in namespace for name in constants | functions):
        raise ValueError("actual hook parser interface changed; review required")
    return namespace["validate_task"], hashlib.sha256(source.encode()).hexdigest()


def live_contracts(plan):
    validate, hook_digest = hook_parser()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GITHUB_TOKEN read permission required for live verification")
    records = []
    for work in plan["work_packages"]:
        number = work["issue"]
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/issues/{number}",
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "User-Agent": "pfm-plan-check"})
        with urllib.request.urlopen(request, timeout=8) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError(f"issue #{number}: response too large")
        issue = json.loads(raw)
        body = issue.get("body") or ""
        if issue.get("pull_request") or issue.get("number") != number or len(body.encode()) > 256 * 1024:
            raise ValueError(f"issue #{number}: invalid issue identity/body")
        if issue.get("state") != "open":
            records.append({"issue": number, "status": "CLOSED_NOT_DISPATCHABLE"})
            continue
        errors, scalars, paths = validate(body)
        if not body.startswith("PFM_TASK_V3\n"):
            errors.append("missing leading V3")
        if scalars.get("TARGET_BRANCH") != work["branch"] or scalars.get("TASK_KIND") != "framework" or scalars.get("DEPENDENCY_POLICY") != work["dependency_policy"]:
            errors.append("saved authorization differs from plan")
        if set(re.findall(r"GF-R\d{2}", body)) != set(work["requirements"]):
            errors.append("saved requirement allocation differs from plan")
        if any(p in {".", "**", "./**", "/"} for p in paths):
            errors.append("unbounded root scope")
        if errors:
            raise ValueError(f"issue #{number}: " + "; ".join(errors))
        records.append({"issue": number, "status": "SYNTAX_VALID_NOT_READY", "body_sha256": hashlib.sha256(body.encode()).hexdigest(), "updated_at": issue.get("updated_at"), "path_count": len(paths)})
    return {"hook_sha256": hook_digest, "contracts": records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--live-contracts", action="store_true")
    args = parser.parse_args()
    try:
        plan = json.loads((DOCS / "plan.json").read_text())
        registry = json.loads((ROOT / "docs/development/milestone-issue-register.json").read_text())
        errors = check(plan, registry)
        for name in plan["documents"]:
            if Path(name).name != name or not (DOCS / name).is_file():
                errors.append("missing/unsafe reference document")
        if errors:
            raise ValueError("; ".join(errors))
        report = {"status": "PLAN_VALID_NOT_IMPLEMENTED", "work_packages": len(plan["work_packages"]), "requirements": len(plan["requirements"])}
        if args.self_test:
            report["self_test"] = self_test(plan, registry)
        if args.live_contracts:
            report["live"] = live_contracts(plan)
        print(json.dumps(report, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
