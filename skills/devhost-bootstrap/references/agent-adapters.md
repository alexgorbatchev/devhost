# Annotation Agent Action Reference

Use this reference when a `devhost.toml` manifest needs an annotation `kind = "agent"` action.

## Decision rules

- Use `adapter` only for built-ins: `"pi"`, `"claude-code"`, or `"opencode"`.
- Do not invent project-local adapter names. A new `adapter = "..."` value requires devhost Go code changes and a release.
- Use a custom command for user-provided or project-local agent integrations.

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
