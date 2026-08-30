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

if (command !== "npm test" && command !== "npm run test") {
  process.stdout.write("{}");
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "allow",
    updatedInput: {
      ...toolInput,
      command: "npm run codex:test",
    },
  },
}));
