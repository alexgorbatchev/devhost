---
created_on: 2026-11-17 00:06
last_modified: 2026-11-18 11:34
status: current
---

# devhost UX flows

## UX flows

Current and proposed user flows for devhost 0.0.12: its browser toolbar and panels, its startup, recovery and error pages, the stack directory, the folder and Markdown pages of serve sessions, and its terminal commands, manifest and machine-wide settings. Current flows document committed code at [edb5c0fc](https://github.com/alexgorbatchev/devhost/commit/edb5c0fc01cabae490e92ac23d4c785ec896c4ed) and mark each observed problem with its finding. Proposed flows are design targets for the linked redesign tickets, not implemented behavior. Every proposal and wireframe follows the [shared UX pattern reference](./patterns.md) ([visual version](./wireframes/patterns.html)); browse all wireframes from the [wireframe index](./wireframes/index.html).

### Work with a coding agent

| Flow | Today | Proposed | Wireframe | Proposal | Redesign |
| ---- | ----- | -------- | --------- | -------- | -------- |
| Chat with a coding agent | [current](./agent-chat-current.html) | [proposed](./agent-chat-proposed.html) | [wireframe](./wireframes/agent-chat.html) | [proposal](./proposals/agent-chat.md), [research notes](./proposals/agent-chat-research.md) | tracked privately |
| Point at the page and attach screenshots | [current](./page-context-current.html) | [proposed](./page-context-proposed.html) | [wireframe](./wireframes/page-context.html) | [proposal](./proposals/page-context.md) | tracked privately |
| Keep agent edits from reloading the page | [current](./reload-control-current.html) | [proposed](./reload-control-proposed.html) | [wireframe](./wireframes/reload-control.html) | [proposal](./proposals/reload-control.md), [research notes](./proposals/reload-control-research.md) | tracked privately |
| See the agents working in this checkout | [current](./running-agents-current.html) | [proposed](./running-agents-proposed.html) | [wireframe](./wireframes/running-agents.html) | [proposal](./proposals/running-agents.md) | tracked privately |

### Keep services healthy

| Flow | Today | Proposed | Wireframe | Proposal | Redesign |
| ---- | ----- | -------- | --------- | -------- | -------- |
| Switch the stack to another checkout | [current](./worktree-switch-current.html) | [proposed](./worktree-switch-proposed.html) | [wireframe](./wireframes/worktree-switch.html) | [proposal](./proposals/worktree-switch.md), [research notes](./proposals/worktree-switch-research.md) | tracked privately |
| Startup pages, crash recovery and app error pages | [current](./startup-and-recovery-current.html) | [proposed](./startup-and-recovery-proposed.html) | [wireframe](./wireframes/startup-and-recovery.html) | [proposal](./proposals/startup-and-recovery.md) | tracked privately |
| Watch and restart services from the toolbar | [current](./services-panel-current.html) | [proposed](./services-panel-proposed.html) | [wireframe](./wireframes/services-panel.html) | [proposal](./proposals/services-panel.md) | tracked privately |
| How devhost reports operations and problems | [current](./notices-and-feedback-current.html) | [proposed](./notices-and-feedback-proposed.html) | [wireframe](./wireframes/notices-and-feedback.html) | [proposal](./proposals/notices-and-feedback.md) | tracked privately |
| Read service logs in the page | [current](./log-minimap-current.html) | [proposed](./log-minimap-proposed.html) | [wireframe](./wireframes/log-minimap.html) | [proposal](./proposals/log-minimap.md) | tracked privately |

### Configure a stack

| Flow | Today | Proposed | Wireframe | Proposal | Redesign |
| ---- | ----- | -------- | --------- | -------- | -------- |
| Edit configuration in the browser | [current](./config-editor-current.html) | [proposed](./config-editor-proposed.html) | [wireframe](./wireframes/config-editor.html) | [proposal](./proposals/config-editor.md), [research notes](./proposals/config-editor-research.md) | tracked privately |
| Edit the manifest and watch it apply | [current](./manifest-hot-reload-current.html) | [proposed](./manifest-hot-reload-proposed.html) | [wireframe](./wireframes/manifest-hot-reload.html) | [proposal](./proposals/manifest-hot-reload.md) | tracked privately |

### Set up and run stacks

| Flow | Today | Proposed | Wireframe | Proposal | Redesign |
| ---- | ----- | -------- | --------- | -------- | -------- |
| Start, find, stop and restart stacks from the terminal | [current](./stack-run-stop-current.html) | [proposed](./stack-run-stop-proposed.html) | [wireframe](./wireframes/stack-run-stop.html) | [proposal](./proposals/stack-run-stop.md), [research notes](./proposals/stack-run-stop-research.md) | tracked privately |
| Change the shared proxy settings | [current](./proxy-settings-current.html) | [proposed](./proxy-settings-proposed.html) | [wireframe](./wireframes/proxy-settings.html) | [proposal](./proposals/proxy-settings.md) | tracked privately |
| Serve a folder or a running port | [current](./serve-folder-current.html) | [proposed](./serve-folder-proposed.html) | [wireframe](./wireframes/serve-folder.html) | [proposal](./proposals/serve-folder.md) | tracked privately |
| Install devhost and the shared HTTPS proxy | [current](./first-run-setup-current.html) | [proposed](./first-run-setup-proposed.html) | [wireframe](./wireframes/first-run-setup.html) | [proposal](./proposals/first-run-setup.md) | tracked privately |
| Find running stacks and routes in the browser | [current](./stack-directory-current.html) | [proposed](./stack-directory-proposed.html) | [wireframe](./wireframes/stack-directory.html) | [proposal](./proposals/stack-directory.md) | tracked privately |

### Inspect the page

| Flow | Today | Proposed | Wireframe | Proposal | Redesign |
| ---- | ----- | -------- | --------- | -------- | -------- |
| The toolbar itself | [current](./toolbar-shell-current.html) | [proposed](./toolbar-shell-proposed.html) | [wireframe](./wireframes/toolbar-shell.html) | [proposal](./proposals/toolbar-shell.md) | tracked privately |
| Use your framework's devtools from the toolbar | [current](./third-party-devtools-current.html) | [proposed](./third-party-devtools-proposed.html) | [wireframe](./wireframes/third-party-devtools.html) | [proposal](./proposals/third-party-devtools.md) | tracked privately |
| Jump between the page and the source | [current](./component-source-current.html) | [proposed](./component-source-proposed.html) | [wireframe](./wireframes/component-source.html) | [proposal](./proposals/component-source.md) | tracked privately |
<!-- ux-flows rows: scaffold-flow.ts inserts new rows above this line -->
