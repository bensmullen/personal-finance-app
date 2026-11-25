#!/usr/bin/env python3
"""Read-only allocation and saved-contract checks; never authorizes execution."""
import argparse
import ast
import copy
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs/development/goal-framework"
REPOSITORY = "bensmullen/personal-finance-app"
MAX_BYTES = 1024 * 1024


def decode(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON key")
            result[key] = value
        return result
    def invalid(_):
        raise ValueError("non-finite JSON number")
    return json.loads(text, object_pairs_hook=pairs, parse_constant=invalid)


def safe_path(path):
    if not isinstance(path, str) or len(path) > 240:
        return False
    base = path[:-3] if path.endswith("/**") else path
    parts = base.split("/")
    if (not re.fullmatch(r"[A-Za-z0-9_.\-/]+", base) or
            any(p in {"", ".", "..", ".git"} for p in parts) or
            base.startswith(".codex/runtime") or
            base.startswith(("src/", "ui/", "app/"))):
        return False
    if path.endswith("/**"):
        return len(parts) >= 3
    return (len(parts) >= 2 and "." in parts[-1]) or base in {"AGENTS.md", "package.json", "package-lock.json", "playwright.config.ts", "stryker.config.mjs"}


def check(plan, registry, *, projected=False):
    """Malformed shape is a validation failure, not an uncaught KeyError."""
    errors = []
    def need(ok, message):
        if not ok:
            errors.append(message)
    try:
        need(type(plan["schema_version"]) is int and plan["schema_version"] == 1, "plan version")
        need(plan["repository"] == REPOSITORY, "repository")
        requirements = {f"GF-R{i:02}" for i in range(1, 25)}
        metrics = {f"GF-M{i:02}" for i in range(1, 11)}
        need(set(plan["requirements"]) == requirements and len(plan["requirements"]) == 24, "requirements")
        need(set(plan["metrics"]) == metrics and len(plan["metrics"]) == 10, "metrics")
        packages = plan["work_packages"]
        by_issue = {w["issue"]: w for w in packages}
        need(len(by_issue) == len(packages) == 9, "package identity")
        need({w["id"] for w in packages} == {f"GF-{i:02}" for i in range(1, 10)}, "package IDs")
        need(len({w["branch"] for w in packages}) == 9, "shared target branch")
        cases = {v["id"]: v["requirement"] for v in plan["verification"]}
        need(len(plan["verification"]) == 24 and cases == {f"GF-V{i:02}": f"GF-R{i:02}" for i in range(1, 25)}, "verification map")
        phases = {p["id"]: p for p in plan["phases"]}
        need(set(phases) == {"P1", "P2", "P3", "P4"} and len(plan["phases"]) == 4, "phases")
        rows = {r["issue_number"]: r for r in registry["issues"]}
        need(len(rows) == len(registry["issues"]), "duplicate register issue")
        need(type(plan["goal_issue"]) is int and plan["goal_issue"] in rows and plan["goal_issue"] not in by_issue, "goal identity")
        covered = set()
        for w in packages:
            need(type(w["issue"]) is int and w["issue"] > 0, "issue type")
            need(w["phase"] in phases, "package phase")
            for key in ("requirements", "verification", "depends_on"):
                need(type(w[key]) is list and len(w[key]) == len(set(w[key])), "duplicate/non-list " + key)
            need(set(w["requirements"]) <= requirements and bool(w["requirements"]), "package requirements")
            covered.update(w["requirements"])
            need({cases.get(v) for v in w["verification"]} == set(w["requirements"]), "verification gap")
            need(w["dependency_policy"] in {"locked", "manifest_edit"}, "dependency policy")
            need(bool(re.fullmatch(r"codex/[A-Za-z0-9_-]+", w["branch"])), "branch syntax")
            need(set(w["depends_on"]) <= set(by_issue) and w["issue"] not in w["depends_on"], "unknown/self dependency")
            for dep in w["depends_on"]:
                need(type(dep) is int and dep in by_issue and by_issue[dep]["phase"] <= w["phase"], "future phase dependency")
            row = rows.get(w["issue"], {})
            need(row.get("blocking_gate") == "GOAL_FRAMEWORK_" + w["phase"], "allocation gate")
            need(row.get("depends_on") == w["depends_on"], "allocation dependencies")
            need(row.get("spec_requirement_ids") == w["requirements"], "allocation requirements")
        need(covered == requirements, "unowned requirement")
        for p in plan["phases"]:
            need(p["gate"] == "GOAL_FRAMEWORK_" + p["id"], "phase gate identity")
            expected = {w["issue"] for w in packages if w["phase"] == p["id"]}
            need(set(p["issues"]) == expected and len(p["issues"]) == len(expected), "phase allocation")
            gate = registry["stage_gates"].get(p["gate"], {})
            ids = gate.get("required_issue_numbers", [])
            required = expected | ({plan["goal_issue"]} if p["id"] == "P4" else set())
            valid_ids = required <= set(ids) if projected else required == set(ids)
            need(valid_ids and len(ids) == len(set(ids)), "phase gate allocation")
            for number in ids:
                need(rows.get(number, {}).get("blocking_gate") == p["gate"], "phase gate owner")
            need(bool(p["exit"].strip()), "phase exit")
        active, complete = set(), set()
        def visit(number):
            if number in active:
                errors.append("dependency cycle")
                return
            if number in complete or number not in by_issue:
                return
            active.add(number)
            for dep in by_issue[number]["depends_on"]:
                visit(dep)
            active.remove(number)
            complete.add(number)
        for number in by_issue:
            visit(number)
        waves = plan["delivery_waves"]
        sequence = [number for wave in waves for number in wave]
        need(len(sequence) == len(set(sequence)) == 9 and set(sequence) == set(by_issue), "delivery inventory")
        seen = set()
        for wave in waves:
            need(type(wave) is list and 0 < len(wave) <= 2, "wave concurrency")
            for number in wave:
                need(set(by_issue[number]["depends_on"]) <= seen, "delivery precedes prerequisite")
            seen.update(wave)
        docs = plan["documents"]
        need(type(docs) is list and len(docs) == len(set(docs)) and "safety-and-rollout.md" in docs, "reference inventory")
        need(all(isinstance(n, str) and re.fullmatch(r"[A-Za-z-]+\.md", n) for n in docs), "reference path")
        audits = plan["audit_controls"]
        need({a["id"] for a in audits} == {f"GF-A{i:02}" for i in range(1, 11)} and len(audits) == 10, "audit controls")
        for a in audits:
            need(bool(a["issues"]) and len(a["issues"]) == len(set(a["issues"])) and set(a["issues"]) <= set(by_issue), "audit ownership")
        # This engineering goal must never become a hidden product prerequisite.
        goal_issues = set(by_issue) | {plan["goal_issue"]}
        for row in registry["issues"]:
            if row["issue_number"] not in goal_issues and (not projected or row["blocking_gate"] not in {p["gate"] for p in phases.values()}):
                need(not set(row["depends_on"]) & goal_issues, "product dependency contamination")
    except (KeyError, TypeError, ValueError, AttributeError):
        errors.append("malformed plan/register shape")
    return errors


def check_documents(contents, plan):
    checks = [("requirements.md", r"(?m)^\| (GF-R\d{2}) \|", plan["requirements"]),
              ("verification-and-metrics.md", r"(?m)^\| (GF-V\d{2}) \|", [v["id"] for v in plan["verification"]]),
              ("verification-and-metrics.md", r"(?m)^\| (GF-M\d{2}) \|", plan["metrics"]),
              ("safety-and-rollout.md", r"(?m)^## (GF-A\d{2}) ", [a["id"] for a in plan["audit_controls"]])]
    errors = []
    for name, pattern, expected in checks:
        found = re.findall(pattern, contents.get(name, ""))
        if set(found) != set(expected) or len(found) != len(expected):
            errors.append("missing/duplicate reference definitions: " + name)
    return errors


def snapshot_registry(report):
    """Allocation snapshots are offline inputs with origin/freshness hints only."""
    snapshot = report["snapshot"]
    if (report["status"] != "LIVE_METADATA_TRACEABILITY_NON_AUTHORIZING" or
            report["authority"] != "issue_metadata" or snapshot["origin"] != REPOSITORY or
            not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", snapshot["generated_at"])):
        raise ValueError("invalid allocation snapshot envelope")
    return snapshot["registry"]


def contract_errors(issue, work, validate, audits):
    number = work["issue"]
    if (not isinstance(issue, dict) or issue.get("pull_request") is not None or
            type(issue.get("number")) is not int or issue.get("number") != number or
            issue.get("state") not in {"open", "closed"} or
            issue.get("html_url") != f"https://github.com/{REPOSITORY}/issues/{number}"):
        return ["issue identity/state"]
    body = issue.get("body")
    if not isinstance(body, str) or len(body.encode()) > 256 * 1024:
        return ["issue body"]
    errors, scalars, paths = validate(body)
    errors = list(errors)
    if not body.startswith("PFM_TASK_V3\n") or len(re.findall(r"(?m)^PFM_TASK_V[23]$", body)) != 1:
        errors.append("one leading V3 required")
    for key in ("TASK_KIND", "TARGET_BRANCH", "DEPENDENCY_POLICY", "ALLOWED_PATHS", "OBJECTIVE", "ACCEPTANCE"):
        if len(re.findall(r"(?m)^" + key + r":", body)) != 1:
            errors.append("ambiguous " + key)
    if (scalars.get("TARGET_BRANCH") != work["branch"] or scalars.get("TASK_KIND") != "framework" or
            scalars.get("DEPENDENCY_POLICY") != work["dependency_policy"]):
        errors.append("authorization differs from plan")
    for prefix, key in (("GF-R", "requirements"), ("GF-V", "verification")):
        if set(re.findall(prefix + r"\d{2}", body)) != set(work[key]):
            errors.append("saved " + key + " allocation")
    expected_audits = {a["id"] for a in audits if number in a["issues"]}
    if set(re.findall(r"GF-A\d{2}", body)) != expected_audits:
        errors.append("saved audit-control allocation")
    if not paths or len(paths) > 128 or len(paths) != len(set(paths)) or not all(safe_path(p) for p in paths):
        errors.append("unsafe/duplicate/unbounded paths")
    return errors


def self_test(plan, registry):
    if check(plan, registry):
        raise ValueError("valid plan rejected")
    mutations = [
        lambda p,r: p.update(schema_version=True), lambda p,r: p["requirements"].pop(),
        lambda p,r: p["work_packages"].append(copy.deepcopy(p["work_packages"][0])),
        lambda p,r: p["work_packages"][0]["depends_on"].append(p["work_packages"][-1]["issue"]),
        lambda p,r: p["work_packages"][0]["verification"].clear(),
        lambda p,r: p["verification"][0].update(requirement="GF-R99"),
        lambda p,r: p["phases"][0]["issues"].clear(),
        lambda p,r: r["stage_gates"]["GOAL_FRAMEWORK_P1"]["required_issue_numbers"].clear(),
        lambda p,r: p["work_packages"][0]["depends_on"].append(999999),
        lambda p,r: p["metrics"].append(p["metrics"][0]),
        lambda p,r: p["work_packages"][1].update(branch=p["work_packages"][0]["branch"]),
        lambda p,r: p["delivery_waves"].reverse(), lambda p,r: p["documents"].append("../escape.md"),
        lambda p,r: p["audit_controls"].pop(), lambda p,r: p.update(work_packages=None),
        lambda p,r: p["phases"][0].update(gate="GOAL_FRAMEWORK_P2"),
    ]
    for mutation in mutations:
        p,r = copy.deepcopy(plan),copy.deepcopy(registry)
        mutation(p,r)
        if not check(p,r):
            raise ValueError("invalid plan accepted")
    r = copy.deepcopy(registry)
    gate = "GOAL_FRAMEWORK_P1"
    r["issues"].append(dict(issue_number=999999, blocking_gate=gate, depends_on=[363]))
    r["stage_gates"][gate]["required_issue_numbers"].append(999999)
    if check(plan, r, projected=True) or not check(plan, r):
        raise ValueError("new metadata task must not require a committed register row")
    r["stage_gates"][gate]["required_issue_numbers"].remove(363)
    if not check(plan, r, projected=True):
        raise ValueError("projected allocation dropped a planned obligation")
    unsafe = [".", "**", "*", "../x", "/tmp/x", "C:/x", "tools/../x", "tools//x", "tools/**", "docs/development/**", "src/x.ts", "ui/x.tsx", ".codex/runtime/a.json", "test/?.ts", "test/[ab].ts", "tools/codex", "docs/development", ".github/workflows"]
    if any(safe_path(p) for p in unsafe) or not safe_path("tools/codex/goal-framework/schemas/**"):
        raise ValueError("path negative failed")
    for raw in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}'):
        try:
            decode(raw)
        except ValueError:
            continue
        raise ValueError("ambiguous JSON accepted")
    validate,_ = hook_parser()
    work = plan["work_packages"][0]
    body = "PFM_TASK_V3\nTASK_KIND: framework\nTARGET_BRANCH: " + work["branch"] + "\nDEPENDENCY_POLICY: locked\n\nALLOWED_PATHS:\n- test/goal.test.ts\n\nOBJECTIVE:\nTest.\n\nACCEPTANCE:\n" + " ".join(work["requirements"] + work["verification"]) + "\n" + " ".join(a["id"] for a in plan["audit_controls"] if work["issue"] in a["issues"])
    issue = {"number": work["issue"], "state": "open", "html_url": f"https://github.com/{REPOSITORY}/issues/{work['issue']}", "body": body}
    if contract_errors(issue,work,validate,plan["audit_controls"]):
        raise ValueError("valid contract rejected")
    bad = [dict(issue, body=body.replace("test/goal.test.ts", "../escape")), dict(issue, body=body+"\nTASK_KIND: product"), dict(issue, state="closed", body="closed without retained contract"), dict(issue, html_url="https://example.invalid"), dict(issue, body=body.replace(work["verification"][0], "GF-V99"))]
    if any(not contract_errors(v,work,validate,plan["audit_controls"]) for v in bad):
        raise ValueError("invalid saved contract accepted")
    doc_fixture = {
        "requirements.md": "\n".join("| " + r + " | definition |" for r in plan["requirements"]),
        "verification-and-metrics.md": "\n".join("| " + r + " | definition |" for r in [v["id"] for v in plan["verification"]] + plan["metrics"]),
        "safety-and-rollout.md": "\n".join("## " + a["id"] + " definition" for a in plan["audit_controls"])}
    if check_documents(doc_fixture, plan):
        raise ValueError("valid reference definitions rejected")
    for name, identifier in (("requirements.md", "GF-R01"), ("verification-and-metrics.md", "GF-V01"), ("verification-and-metrics.md", "GF-M01"), ("safety-and-rollout.md", "GF-A01")):
        changed = dict(doc_fixture)
        changed[name] = changed[name].replace(identifier, identifier + "-missing")
        if not check_documents(changed, plan):
            raise ValueError("missing reference definition accepted")
    return {"positive": 4, "negative": len(mutations)+len(unsafe)+3+len(bad)+5}


def hook_parser():
    path = ROOT / ".codex/hooks/pfm-policy.py"
    source = path.read_text()
    constants = {"APPROVED_BRANCH_PREFIXES", "CONTROL_PATHS", "REQUIRED_SCALARS", "REQUIRED_SECTIONS"}
    functions = {"scalar", "section", "list_section", "normalize", "is_control_path", "validate_task"}
    nodes = [n for n in ast.parse(source).body if (isinstance(n, ast.Assign) and any(isinstance(t,ast.Name) and t.id in constants for t in n.targets)) or (isinstance(n,ast.FunctionDef) and n.name in functions)]
    namespace = {"re": re, "fnmatch": fnmatch}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(path),"exec"),namespace)
    if not all(n in namespace for n in constants | functions):
        raise ValueError("hook parser interface changed")
    return namespace["validate_task"],hashlib.sha256(source.encode()).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise ValueError("API redirect refused")


def live_contracts(plan):
    validate,digest = hook_parser()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("read token required")
    records = []
    opener = urllib.request.build_opener(NoRedirect())
    for work in plan["work_packages"]:
        number = work["issue"]
        req = urllib.request.Request(f"https://api.github.com/repos/{REPOSITORY}/issues/{number}",headers={"Accept":"application/vnd.github+json","Authorization":f"Bearer {token}","User-Agent":"pfm-plan-check"})
        with opener.open(req,timeout=8) as response:
            raw = response.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES:
            raise ValueError("API response limit")
        issue = decode(raw)
        errors = contract_errors(issue,work,validate,plan["audit_controls"])
        if errors:
            raise ValueError(f"issue #{number}: " + "; ".join(errors))
        records.append({"issue":number,"status":"SYNTAX_VALID_NOT_READY" if issue["state"]=="open" else "SYNTAX_VALID_CLOSED_NOT_ACCEPTED", "body_sha256":hashlib.sha256(issue["body"].encode()).hexdigest(),"updated_at":issue.get("updated_at")})
    return {"hook_sha256":digest,"contracts":records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test",action="store_true")
    parser.add_argument("--live-contracts",action="store_true")
    parser.add_argument("--allocation-snapshot", type=Path, help="check generated allocation offline, without a committed register")
    args = parser.parse_args()
    try:
        if hasattr(signal,"SIGALRM"):
            def deadline(_signum,_frame):
                raise TimeoutError("total checker deadline exceeded")
            signal.signal(signal.SIGALRM,deadline)
            signal.alarm(100)
        def read(path):
            if path.is_symlink() or path.stat().st_size>MAX_BYTES:
                raise ValueError("unsafe/oversized reference")
            return path.read_text()
        plan = decode(read(DOCS/"plan.json"))
        if args.allocation_snapshot:
            if args.self_test:
                raise ValueError("built-in fixtures require the baseline register")
            registry = snapshot_registry(decode(read(args.allocation_snapshot)))
        else:
            registry = decode(read(ROOT/"docs/development/milestone-issue-register.json"))
        errors = check(plan, registry, projected=args.allocation_snapshot is not None)
        if errors:
            raise ValueError("; ".join(errors))
        contents = {name: read(DOCS/name) for name in plan["documents"]}
        errors = check_documents(contents, plan)
        if errors:
            raise ValueError("; ".join(errors))
        report = {"status":"PLAN_VALID_NOT_IMPLEMENTED","work_packages":len(plan["work_packages"]),"requirements":len(plan["requirements"])}
        if args.allocation_snapshot:
            report["allocation"] = "OFFLINE_SNAPSHOT_NON_AUTHORIZING"
        if args.self_test:
            report["self_test"] = self_test(plan,registry)
        if args.live_contracts:
            report["live"] = live_contracts(plan)
        print(json.dumps(report,indent=2))
        return 0
    except Exception as error:
        # Never print request headers, bodies or credentials on failures.
        print(json.dumps({"status":"FAIL","reason":str(error)[:300]}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
