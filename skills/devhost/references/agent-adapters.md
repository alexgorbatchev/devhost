# Annotation Agent Action Reference

Use this reference when a `devhost.toml` manifest needs an annotation `kind = "agent"` action.

## Decision rules

- Use `adapter` only for built-ins: `"pi"`, `"claude-code"`, or `"opencode"`.
- Built-in adapters accept an optional `args = ["..."]` string array to pass extra CLI flags (e.g., model, thinking level, or permission modes) while preserving built-in status reporting and prompt handoff. An empty array `args = []` is accepted when no extra arguments are passed.
- `args` is only valid when `adapter` is configured; it cannot be used with custom command agents.
- Do not invent project-local adapter names. A new `adapter = "..."` value requires devhost Go code changes and a release.
- Use a custom command for user-provided or project-local agent integrations. Custom agent actions omit `adapter` and use `displayName`, `command`, optional `cwd`, and optional `env` inside `[annotation.actions.agent]`.

## Built-in adapter form

Built-in adapters provide zero-configuration terminal integration, automatic status reporting, and prompt handoff for supported coding agents:

- `"pi"`: launches `pi -e <extension> [args...] @<prompt-file>`
- `"claude-code"`: launches `claude --settings <settings> [args...] <instruction>`
- `"opencode"`: launches `opencode run [args...] <instruction>`

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

- `adapter` must be one of `"pi"`, `"claude-code"`, or `"opencode"`.
- `args` is optional. When specified, it must be an array of non-empty strings (e.g. `args = ["--model", "sonnet"]`) or an empty array `args = []`.
- `args` is only supported when `adapter` is configured.
- When `adapter` is configured, custom command fields (`command`, `cwd`, `env`) must be omitted.

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

Devhost injects these environment variables for custom commands:

- `DEVHOST_AGENT_ANNOTATION_FILE`: JSON annotation payload.
- `DEVHOST_AGENT_PROMPT_FILE`: rendered prompt text.
- `DEVHOST_AGENT_TRANSPORT`: currently `files`.
- `DEVHOST_AGENT_DISPLAY_NAME`: configured display name.
- `DEVHOST_PROJECT_ROOT`: manifest project root.
- `DEVHOST_STACK_NAME`: devhost stack name.

The custom agent must read `DEVHOST_AGENT_PROMPT_FILE` or `DEVHOST_AGENT_ANNOTATION_FILE` and handle the requested change.

## Queue status contract

To support durable annotation queue draining, custom agents must emit terminal OSC status events:

- Working: `\x1b]1337;SetAgentStatus=working\x07`
- Finished/ready for next item: `\x1b]1337;SetAgentStatus=finished\x07`

BEL (`\x07`) and ST (`\x1b\\`) terminators are accepted.

If a wrapper script is needed, keep it project-local and invoke the script directly from `command`; do not put shell snippets in the manifest.
