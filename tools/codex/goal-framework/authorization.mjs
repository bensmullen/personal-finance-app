import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { canonicalJson, digest, inspectV3Body, planAlignedTask, validateGoal, validateScopeCensus } from './contracts.mjs';
import { resourceAttest, resourceRef, requireResource } from './resources.mjs';

const maxIssueBytes = 256 * 1024;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The supervisor supplies the immutable merged source, never a worker path.
// Execute only after the exact reviewed source and interpreter are attested.
const parserBridge = `
import json, sys
source, body = json.load(sys.stdin)
scope = {'__name__': 'pfm_pinned_policy'}
exec(compile(source, '<trusted-pfm-policy>', 'exec'), scope)
errors, values, writes = scope['validate_task'](body)
print(json.dumps({'errors': errors, 'values': values, 'writes': writes}))
`;

export function pinnedV3Parser({ source, revision, python, verify }) {
  requireResource(typeof source === 'string' && Buffer.byteLength(source) <= maxIssueBytes
    && /^[a-f0-9]{40}$/.test(revision) && isAbsolute(python), 'PINNED_PARSER_INPUT');
  const pin = { revision, digest: sha256(source), python };
  return (issue) => {
    resourceAttest(verify, 'merged_v3_parser', pin);
    const offline = inspectV3Body(issue.body);
    requireResource(!offline.allowedPaths.some((path) => /^\.codex\/logs(?:\/|$)/i.test(path)), 'PROTECTED_RUNTIME_PATH');
    const result = spawnSync(python, ['-I', '-B', '-c', parserBridge], {
      input: JSON.stringify([source, issue.body]), encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      env: { LC_ALL: 'C' },
    });
    requireResource(!result.error && result.status === 0, 'PINNED_PARSER_UNAVAILABLE');
    const { errors, values, writes } = JSON.parse(result.stdout);
    requireResource(errors.length === 0 && values.TARGET_BRANCH === offline.branch
      && values.TASK_KIND === offline.taskKind && values.DEPENDENCY_POLICY === offline.dependencyPolicy
      && canonicalJson(writes) === canonicalJson(offline.allowedPaths), 'PINNED_PARSER_DISAGREEMENT');
    return { ...offline, parser_revision: revision, parser_digest: pin.digest };
  };
}

export function savedAuthorization(issue, identity, { parseSaved, verify }) {
  requireResource(issue?.repository === identity.repository && issue.number === identity.task_issue
    && issue.state === 'open' && issue.kind === 'issue' && typeof issue.body === 'string'
    && Buffer.byteLength(issue.body) <= maxIssueBytes, 'SAVED_ISSUE_IDENTITY');
  resourceRef(issue.evidence);
  const bodyDigest = sha256(issue.body);
  resourceAttest(verify, 'live_saved_issue', { ...identity, body_digest: bodyDigest, evidence: issue.evidence });
  const parsed = parseSaved(issue);
  requireResource(parsed.issueBodyDigest === bodyDigest && /^[a-f0-9]{40}$/.test(parsed.parser_revision)
    && /^[a-f0-9]{64}$/.test(parsed.parser_digest), 'SAVED_PARSER_IDENTITY');
  return parsed;
}

export function reviewPreparation(identity, input, host) {
  const { verify, now, consumedNonces } = host;
  const v3 = savedAuthorization(input.issue, identity, host);
  const authority = { verify, now, consumedNonces };
  const goal = validateGoal(input.goal, input.approval, authority);
  const alignment = planAlignedTask(goal, input.approval, input.alignment, authority);
  requireResource(goal.repository === identity.repository && goal.goal_issue === identity.goal_issue
    && goal.control_revision === identity.goal_revision && alignment.disposition === 'aligned'
    && alignment.sizing !== 'reuse', 'PREPARATION_GOAL');
  const census = validateScopeCensus(input.census, {
    v3, requirements: input.routes, implementer: input.workspace.receipt_owner, verify,
  });
  requireResource(census.repository === identity.repository && census.task_issue === identity.task_issue
    && census.goal_issue === goal.goal_issue && census.goal_revision === goal.control_revision
    && census.goal_control_digest === input.alignment.goal_control_digest
    && census.risk === input.alignment.risk && census.baseline_sha === identity.head_sha, 'PREPARATION_CENSUS');
  resourceAttest(verify, 'task_dependencies_satisfied', { ...identity, body_digest: v3.issueBodyDigest });
  return { ...v3, census_digest: digest(census), required_paths: census.required_write_paths,
    goal_control_digest: census.goal_control_digest, risk: census.risk, budget_policy: goal.budget_policy,
    writer_limit: goal.concurrency_policy.implementation_writers,
    review_limit: goal.concurrency_policy.review_backlog };
}

// Replace only the exact machine sections. Preserve other bytes, including metadata,
// comments, objective and line endings. Review must approve the full before/after.
export function levelOneBody(body, { paths, acceptance }) {
  inspectV3Body(body);
  requireResource(Array.isArray(paths) && paths.length >= 1 && paths.length <= 128
    && paths.every((path) => typeof path === 'string' && /^\S{1,240}$/.test(path)), 'CORRECTION_PATHS');
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  requireResource(newline === '\n' || !/(^|[^\r])\n/.test(body), 'CORRECTION_LINE_ENDINGS');
  requireResource(typeof acceptance === 'string' && acceptance.length <= 16 * 1024 && acceptance.trim() === acceptance
    && acceptance.length > 0 && !/\r|^[ \t]*(?:<!--|#{1,6}[ \t])|^[A-Z][A-Z0-9_]*:\s*$/m.test(acceptance), 'CORRECTION_ACCEPTANCE');
  function replaceSection(text, key, replacement) {
    const start = text.indexOf(`${newline}${key}:${newline}`) + newline.length + key.length + 1 + newline.length;
    const tail = text.slice(start);
    const boundary = /^(?:[A-Z][A-Z0-9_]*:[ \t]*\r?$|[ \t]*(?:<!--|#{1,6}[ \t]))/m.exec(tail);
    const section = tail.slice(0, boundary?.index ?? tail.length);
    const content = section.trimEnd();
    requireResource(content.length !== 0, 'CORRECTION_SECTION');
    return text.slice(0, start) + replacement + tail.slice(content.length);
  }
  const next = replaceSection(replaceSection(body, 'ALLOWED_PATHS', paths.map((path) => '- ' + path).join(newline)),
    'ACCEPTANCE', acceptance.replaceAll('\n', newline));
  inspectV3Body(next);
  requireResource(next !== body, 'CORRECTION_NO_CHANGE');
  return next;
}
