# Annotation Agent Action Reference

Use this reference when a `devhost.toml` manifest needs an annotation `kind = "agent"` action.

## Decision rules

- Use `adapter` only for built-ins: `"pi"`, `"claude-code"`, `"opencode"`, or `"codex"`.
- Built-in adapters accept an optional `args = ["..."]` string array to pass extra CLI flags (e.g., model, thinking level, or permission modes) while preserving built-in status reporting and prompt handoff. An empty array `args = []` is accepted when no extra arguments are passed.
- `args` is only valid when `adapter` is configured; it cannot be used with custom command agents.
- Do not invent project-local adapter names. A new `adapter = "..."` value requires devhost Go code changes and a release.
- Use a custom command for user-provided or project-local agent integrations. Custom agent actions omit `adapter` and use `displayName`, `command`, optional `cwd`, and optional `env` inside `[annotation.actions.agent]`.

## Built-in adapter form

Built-in adapters provide terminal integration, status reporting, and prompt handoff for supported coding agents:

- `"pi"`: launches `pi -e <extension> [args...] @<prompt-file>`
- `"claude-code"`: launches `claude --settings <settings> [args...] <instruction>`
- `"opencode"`: launches `opencode run [args...] <instruction>`
- `"codex"`: launches `codex --no-daemon -c <status-hook-config> ... [args...] <instruction>`; review and trust the status hooks in `/hooks` before using durable queues

```toml
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
label = "Ask Claude"
kind = "agent"

[annotation.actions.agent]
adapter = "claude-code"
args = ["--thinking", "high"]
```

Example with `pi`:

```toml
[[annotation.actions]]
id = "fix-pi"
label = "Ask Pi"
kind = "agent"

[annotation.actions.agent]
adapter = "pi"
args = ["--thinking", "high"]
```

Example with `opencode`:

```toml
[[annotation.actions]]
id = "fix-opencode"
label = "Ask OpenCode"
kind = "agent"

[annotation.actions.agent]
adapter = "opencode"
args = ["--model", "gpt-4o"]
```

Rules:

- `adapter` must be one of `"pi"`, `"claude-code"`, `"opencode"`, or `"codex"`.
- `args` is optional. When specified, it must be an array of non-empty strings (e.g. `args = ["--model", "sonnet"]`) or an empty array `args = []`.
- `args` is only supported when `adapter` is configured.
- When `adapter` is configured, custom command fields (`command`, `cwd`, `env`) must be omitted.

## Codex

Install and sign in to the Codex CLI before selecting this adapter. Use a version supporting
`--no-daemon` and lifecycle hooks; the adapter is validated against 0.159.2.

```toml
[[annotation.actions]]
id = "ask-codex"
label = "Ask Codex"
kind = "agent"

[annotation.actions.agent]
adapter = "codex"
args = ["-c", "model_reasoning_effort=high"]
```

Review and trust the devhost hooks using `/hooks` in the embedded Codex terminal. Leave those
hooks enabled for queue draining. If trust is missing or an admin requires managed hooks only,
report that queues cannot drain; do not bypass hook trust or alter admin policy.
Keep Codex authentication, sandbox, approval, and syntax theme settings user-controlled.
Pass optional model, reasoning, or theme overrides through `args`.
If the initial annotation finishes before hook review, send another prompt after trusting the
hooks to report readiness and drain waiting annotations.

## Custom command form

```toml
[annotation]
defaultAction = "fix"

[[annotation.actions]]
id = "fix"
label = "Ask My Agent"
kind = "agent"

[annotation.actions.agent]
displayName = "My Agent"
command = ["./scripts/devhost-agent.sh"]
cwd = "."

[annotation.actions.agent.env]
MY_AGENT_MODE = "annotation"
```

Rules:

- Set `displayName` to the label shown in the UI.
- Use a string-array `command`; devhost executes it directly, not through a shell.
- Keep `cwd` at the manifest directory unless the agent must run elsewhere.
- Prefer a real executable or script path in `command` over inline shell behavior.

## Runtime contract

Set `tempDir = ".tmp/annotations"` inside the root manifest's `[annotation]` table
to store annotation JSON, prompts, and agent support files beneath devhost's startup
working directory. Absolute paths are accepted. Omit the key to use the system temp
directory (`$TMPDIR` on Unix, otherwise `/tmp`); empty strings are invalid. This setting
applies to both agent and command actions, including queued agent handoffs. Action
`cwd` and the manifest directory do not affect resolution.

Missing parents are created. Each session or queued handoff receives a unique private
subdirectory; cleanup removes its files without deleting the configured parent or
other sessions. Directory creation failures are reported without a fallback. Durable
queue storage uses its existing state location.

Devhost injects these environment variables for custom commands:

- `DEVHOST_AGENT_ANNOTATION_FILE`: JSON annotation payload.
- `DEVHOST_AGENT_PROMPT_FILE`: rendered prompt text.
- `DEVHOST_AGENT_TRANSPORT`: currently `files`.
- `DEVHOST_AGENT_DISPLAY_NAME`: configured display name.
- `DEVHOST_PROJECT_ROOT`: manifest project root, remapped into the selected repository checkout when worktree support is enabled.
- `DEVHOST_STACK_NAME`: devhost stack name.

The custom agent must read `DEVHOST_AGENT_PROMPT_FILE` or `DEVHOST_AGENT_ANNOTATION_FILE` and handle the requested change.

With `[worktrees].enabled = true`, new browser-launched actions use the selected checkout. Configured action directories inside the service repository are remapped with their relative offsets; directories outside it remain unchanged. Existing sessions retain their launch directory. Devhost rejects queued handoffs into a session from another checkout and pauses the queue; resume it to start an agent in the selected checkout. Do not dispatch new work into an old-checkout session.

## Queue status contract

To support durable annotation queue draining, custom agents must emit terminal OSC status events:

- Working: `\x1b]1337;SetAgentStatus=working\x07`
- Finished/ready for next item: `\x1b]1337;SetAgentStatus=finished\x07`

BEL (`\x07`) and ST (`\x1b\\`) terminators are accepted.

If a wrapper script is needed, keep it project-local and invoke the script directly from `command`; do not put shell snippets in the manifest.
