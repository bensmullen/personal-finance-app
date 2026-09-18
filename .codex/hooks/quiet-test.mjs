let input = "";
for await (const chunk of process.stdin) input += chunk;

let payload;
try {
  payload = JSON.parse(input);
} catch {
  process.stdout.write("{}");
  process.exit(0);
}

if (payload?.hook_event_name !== "PreToolUse" || payload?.tool_name !== "Bash") {
  process.stdout.write("{}");
  process.exit(0);
}

const toolInput = payload.tool_input;
const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
const overridePrefix = "CODEX_ALLOW_BROAD_VERIFY=1 ";

const targetedNpmScript = (value, script) => {
  const prefix = `npm run ${script} -- `;
  if (!value.startsWith(prefix)) return false;
  const first = value.slice(prefix.length).trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && !first.startsWith("-");
};

const targetedRunner = (value, prefix) => {
  if (!value.startsWith(prefix)) return false;
  const first = value.slice(prefix.length).trim().split(/\s+/)[0] ?? "";
  return first.length > 0 && !first.startsWith("-");
};

const broadReason = (value) => {
  if (value === "npm test" || value === "npm run test") return "full unit-test suite";
  if (value.startsWith("npm run codex:test") && !targetedNpmScript(value, "codex:test"))
    return "full unit-test suite";
  if (value.startsWith("npm run test:e2e") && !targetedNpmScript(value, "test:e2e"))
    return "full Playwright suite";
  if (/^npm run (?:codex:verify|typecheck|build:web|architecture:validate|spec:validate)(?:\s|$)/.test(value))
    return "broad repository verification";
  if ((value === "npx vitest run" || value.startsWith("npx vitest run ")) && !targetedRunner(value, "npx vitest run "))
    return "full Vitest suite";
  if ((value === "vitest run" || value.startsWith("vitest run ")) && !targetedRunner(value, "vitest run "))
    return "full Vitest suite";
  if ((value === "npx playwright test" || value.startsWith("npx playwright test ")) && !targetedRunner(value, "npx playwright test "))
    return "full Playwright suite";
  if ((value === "playwright test" || value.startsWith("playwright test ")) && !targetedRunner(value, "playwright test "))
    return "full Playwright suite";
  return undefined;
};

if (command.startsWith(overridePrefix)) {
  const unwrapped = command.slice(overridePrefix.length).trim();
  if (unwrapped === "npm test" || unwrapped === "npm run test") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        updatedInput: {
          ...toolInput,
          command: `${overridePrefix}npm run codex:test`,
        },
      },
    }));
    process.exit(0);
  }
  process.stdout.write("{}");
  process.exit(0);
}

const segments = command
  .split(/\s*(?:&&|\|\||;|\n)\s*/)
  .map((value) => value.trim())
  .filter(Boolean);

const blocked = segments
  .map((value) => ({ value, reason: broadReason(value) }))
  .find((item) => item.reason !== undefined);

if (blocked) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `Blocked ${blocked.reason} by repository verification policy. Use the smallest focused check instead. If this broad check is materially required, state the concrete reason first and rerun the single command with CODEX_ALLOW_BROAD_VERIFY=1 prefix.`,
    },
  }));
  process.exit(0);
}

process.stdout.write("{}");
