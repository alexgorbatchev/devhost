---
title: "The devtools toolbar"
---

<!-- guide-demo -->
<video controls playsinline preload="none" width="1920" height="1080" style="width:100%;height:auto" poster="https://alexgorbatchev.github.io/devhost/demos/devtools.webp" aria-label="devtools demo">
  <source src="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4" type="video/mp4">
  <track kind="captions" src="https://alexgorbatchev.github.io/devhost/demos/devtools.vtt" srclang="en" label="English">
  <a href="https://alexgorbatchev.github.io/devhost/demos/devtools.mp4">Watch the demo video</a>.
</video>
<!-- /guide-demo -->

devhost can add a small toolbar to every page of your app: service status and restarts, live logs, a chat with your coding agent, Git worktree switching, and host resource usage. Routing works the same with or without it.

## Turn it on or off

The toolbar appears when at least one devtools feature is on, and most are on by default:

| Setting                               | Default | Adds                                                            |
| ------------------------------------- | ------- | --------------------------------------------------------------- |
| `[devtools.status].enabled`           | `true`  | Service status, the Services panel, and the crash recovery view |
| `[devtools.minimap].enabled`          | `true`  | The log minimap                                                 |
| `[devtools.chat].enabled`             | `true`  | [Chat with your coding agent](../annotations/)                  |
| `[devtools.annotations].enabled`      | `true`  | Element selection and drawing for chat                          |
| `[devtools.editor].enabled`           | `true`  | [Open component source](#open-component-source)                 |
| `[devtools.externalToolbars].enabled` | `true`  | [Third-party devtools](#third-party-devtools) launchers         |
| `[devtools.configEditor].enabled`     | `false` | The [config editor](#config-editor)                             |
| `[devtools.resources].enabled`        | `true`  | [CPU, RAM, and disk readouts](#host-resource-usage)             |

With all of them off except `resources`, devhost injects nothing. Startup and recovery pages work either way. Every setting applies to open pages as soon as you save the manifest.

## The toolbar

The toolbar sits at the bottom-right corner of the page; `[devtools.status].position = "top-right"` moves it up. It shows the stack name, service health, **Chat**, **Worktrees**, launchers for third-party devtools, and the readouts. Click the stack name to collapse it to a single health dot.

The toolbar stays out of your page's way:

- Clicks around it reach your page, and its styles never mix with your page's styles.
- It stays above your page's popovers and modal dialogs, and chat keeps working while a modal is open.
- Keys you type into it, such as in the chat composer, never trigger your page's shortcuts. Click the page to give it the keyboard back.

## Services panel

Open the Services panel from the toolbar:

- **Applications** lists services with a hostname, as links that open in a new tab. **Services** lists the rest.
- Each managed service has a restart control. External services are tagged `external`.
- Services whose `watch` paths changed are marked `changed`. The reload icon next to the toolbar's `changed` badge restarts them without opening the panel.
- **Restart Changed** restarts the changed services, or the primary service when none changed. Its shortcut is **Alt+Ctrl+R**; set `[devtools.shortcuts].restartServices` to change it.
- **Restart Stack** restarts every managed service with new automatic ports.
- **Stopped services** appears when you [started only part of the stack](../stack-lifecycle/#start-part-of-a-stack); **Start** starts one of them.

When a service crashes, a full-screen view shows its exit code and logs with a **Restart** button. See [Restarts and recovery](../../stacks/recovery/) for what each restart does.

The **Worktrees** button switches the stack to another Git checkout; see [Git worktrees](../../stacks/worktrees/).

## Log minimap

The log minimap shows output from every service as it arrives. Hover it to read the latest lines, with service names in a column and terminal colors kept readable in both themes. Set `[devtools.minimap].enabled = false` to hide it.

## Host resource usage

The toolbar shows how busy the machine running devhost is:

| Readout  | Measures                                                               | Read every |
| -------- | ---------------------------------------------------------------------- | ---------- |
| **CPU**  | Share of all logical CPUs that was busy since the last reading         | 2 seconds  |
| **RAM**  | Memory in use, out of the memory installed                             | 2 seconds  |
| **Disk** | Space used across fixed local disks, out of the space available to you | 1 minute   |

A bar turns amber at 70% and red at 90%. Hover a readout for the numbers behind it, such as `RAM: 9.8 of 32 GB used`. On Linux, disk usage leaves out USB, removable, and loop-mounted drives; on macOS it reports the startup disk.

Change what is shown and how often:

```toml
[devtools.resources]
pollInterval = "5s"      # all three readouts

[devtools.resources.cpu]
pollInterval = "1s"      # just this one

[devtools.resources.memory]
enabled = false          # hide one readout
```

`pollInterval` is a duration of at least `"250ms"`, such as `"500ms"`, `"5s"`, or `"1m"`. A readout uses its own value, then the shared one, then its default. `[devtools.resources].enabled = false` hides all three and stops sampling.

A readout that devhost cannot read is hidden, and devhost logs the reason once. All three hide while the page has lost its connection to devhost, so a stale number never passes for a current one.

## Config editor

The config editor lets you edit the stack's manifests and `config.toml` in the browser, and applies each save through [hot reload](../../stacks/hot-reload/). It is off by default, because a manifest decides which commands devhost runs:

```toml
[devtools.configEditor]
enabled = true
```

**Config** in the toolbar then opens the editor. Its **File** list holds:

- the root manifest (after a worktree switch, the one in the selected checkout),
- every manifest its `includes` reach,
- the machine-wide `config.toml`, which the editor creates if it does not exist.

As you type, devhost runs the same checks as a reload: TOML syntax, allowed settings and values, dependency cycles, ports, and working directories. Problems are marked on their line and listed below the text. The editor completes table names, keys, and fixed-choice values; press **Ctrl+Space** (**Option+I** on macOS) to list completions.

**Save** (**Meta+S** on macOS, **Ctrl+S** elsewhere) writes the file only when it passes the checks, then reports **Saved and applied.** once the reload finishes, or why the reload was rejected. Unsaved changes stay with each file while you switch files or close the window; **Revert** discards them.

- If the file changed on disk after the editor opened it, the save is refused with **The file changed on disk**. **Load from disk** replaces your changes with the version on disk.
- Only a browser on the same machine can save, even when Caddy listens on all interfaces.
- Saving keeps the file's permissions, and a symbolic link keeps pointing at its target.

### Rejected reloads

When a save of a manifest or `config.toml` is rejected, from the editor or any other program, the toolbar shows the reason under it until a later save is accepted. With the editor on, **Edit** in that notice opens the file and **Config** turns red.

## Open component source

**Alt + right-click** on an element opens its React component's source file in your editor and copies the path. It needs a development build that exposes source locations, and opens the file in the selected worktree.

```toml
[devtools.editor]
ide = "vscode"   # or "vscode-insiders", "cursor", "webstorm"
```

devhost opens the editor through its URL handler. To highlight the element under your editor's cursor instead, see [Highlight source locations](../react-highlight/).

## Third-party devtools

The toolbar collects the launcher buttons of devtools your app already mounts, so they stop covering your page. Each integration has its own setup page:

- [Redux Toolkit and Zustand](../../integrations/redux/)
- [TanStack](../../integrations/tanstack/)
- [Vue DevTools](../../integrations/vue/)
- [React Hook Form](../../integrations/react-hook-form/)
- [Jotai](../../integrations/jotai/)

Set `[devtools.externalToolbars].enabled = false` to leave their launchers alone.

## Under the hood

The toolbar talks to the stack through routes under `/__devhost__/` on your app's own hostname; your app never sees those requests. See the [Control API](../../reference/control-api/) for the endpoints, caching, and request rules.
