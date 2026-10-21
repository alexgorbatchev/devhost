---
created_on: 2026-04-22 11:47
last_modified: 2026-10-21 07:44
status: current
---

# Go Runtime Notes

The shipped devhost runtime lives in `apps/devhost`. Bun builds the injected browser UI and runs the browser-facing tests. Contributor commands and release procedures are maintained in [AGENTS.md](./AGENTS.md) and [RELEASE.md](./RELEASE.md).

## Browser coding-agent integration

The instance control server discovers the installed Codex and Claude Code clients, starts native sessions in the selected project, and relays their original protocol frames through the chat WebSocket. The browser projects those frames into the shared assistant-ui runtime. Native permission and question requests remain explicit user decisions.

The chat endpoints are `/__devhost__/chat/harnesses`, `/__devhost__/chat/sessions`, and `/__devhost__/ws/chat`. Their implementations and exact DTOs live in `internal/devtools/chat_server.go` and `internal/devtools/chat_types.go`; protocol and lifecycle tests live beside them. Session shutdown owns the native process group and its streams.

Page selection and drawing annotations are browser context for chat. Sending annotated context requests native tab sharing and captures one PNG with the annotations. The capture excludes the chat panel and dock and stops its media tracks after capture or failure. The public [annotations guide](../../packages/docs/src/content/docs/guides/annotations.md) describes the current workflow.

Component-source navigation opens an external IDE URL handler. React Highlight retains its instance-scoped browser-overlay transport for integrations. The current runtime has no embedded terminal, Neovim launcher, durable annotation queue, or agent PTY transport. `TestChatReplacesObsoleteTerminalRoutes` in `internal/devtools/chat_server_test.go` checks the removed endpoint paths.

## Validation

Run `just check` from the repository root for the required package and repository gates. `just devhost test` runs the Go app tests; `just ui check` covers the browser UI, including genuine native tab-capture acceptance. Installed-client discovery and initialization tests are opt-in through `DEVHOST_TEST_INSTALLED_HARNESSES=1`; inference still depends on the client's configured account.
