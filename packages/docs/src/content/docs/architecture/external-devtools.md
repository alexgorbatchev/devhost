---
title: "External Devtools"
---

The external devtools feature aggregates supported third-party launcher buttons into the injected `devhost` overlay without taking ownership of the third-party panels themselves. It is intentionally conservative: `devhost` proxies launcher actions, hides the native launcher chrome, and lets the host library keep rendering and managing its own panel state.

## Architecture Flow

```mermaid
sequenceDiagram
    participant Host as Host Page DOM
    participant Hook as useExternalDevtoolsLaunchers
    participant Adapter as External Devtools Adapter
    participant Style as Injected Hide Style
    participant UI as ExternalDevtoolsPanel
    participant Tool as Native Devtools

    Hook->>Adapter: isInstalled() / isOpen()
    Adapter->>Host: Query stable selectors
    Adapter-->>Hook: Installed adapters + open state
    Hook->>Style: Write selector-based hide rules
    Hook-->>UI: Launcher list snapshot

    Host->>Hook: MutationObserver(body subtree)
    Hook->>Adapter: Recompute installation/open state
    Hook->>Style: Update hide rules only if changed
    Hook-->>UI: Refresh button pressed state

    UI->>Hook: toggleLauncher(id)
    Hook->>Adapter: open() or close()
    Adapter->>Tool: Click native launcher/minimize control
    Tool->>Host: Render or collapse native panel
    Host->>Hook: MutationObserver(body subtree)
    Hook-->>UI: Refresh button pressed state
```

## How it works

### Adapter-Owned Host Knowledge

Each supported third-party tool is modeled as an `IExternalDevtoolsAdapter` under `src/devtools/features/externalDevtoolsPanel/`. `externalDevtoolsDetectors.ts` registers the Query, Router, and unified TanStack shell adapters; `createReactHookFormDevtoolsDetector.ts` and `createJotaiDevtoolsDetector.ts` discover one adapter per mounted native inspector. The hook combines those adapters on every synchronization and resolves a launcher ID against the current adapters before dispatching an action.

- `isInstalled()` answers whether the host page appears to have mounted the tool.
- `isOpen()` answers whether the native panel is currently expanded.
- `open()` and `close()` proxy the tool's own launcher or minimize controls.
- `hideSelectors` lists the host selectors whose launcher chrome should be hidden while `devhost` is aggregating that tool.

This keeps host-specific selectors and behavior in one place instead of spreading them through the panel component or the hook.

### Selector-Based Suppression

The feature does **not** remove host-owned nodes or keep mutable references to specific launcher elements. Instead, `useExternalDevtoolsLaunchers.ts` writes a narrowly scoped `<style>` tag into `document.head` with `display: none !important` rules derived from the installed adapters.

That approach is more resilient than mutating individual nodes because it survives:

- React or library-driven DOM replacement
- launcher state transitions between collapsed and expanded modes
- repeated host re-renders that recreate the native launcher elements

The native panel DOM remains untouched and fully owned by the third-party library.

### Mutation Observation and Loop Prevention

Because these integrations depend on host-page DOM state, the hook observes `document.body` for subtree changes and recomputes the installed launchers whenever the host UI changes.

The observer intentionally avoids a full-document watch and batches recomputation behind `requestAnimationFrame`. It observes native open-state attributes, including the unified shell's `data-open`. The hide-style text is only rewritten when the selector set actually changes. Those guards prevent the injected feature from reacting to its own style updates and locking the page.

### UI Contract

`ExternalDevtoolsPanel.tsx` is only responsible for rendering the aggregated buttons and surfacing each launcher's current `isOpen` state.

- active buttons use the devtools primary button styling
- inactive buttons use the secondary styling
- button clicks always flow back through `toggleLauncher(id)` in the hook

This keeps the UI purely declarative while the adapters own the imperative host interactions.

### Safety Boundaries

The feature is deliberately scoped to launchers, not panels.

- `devhost` may hide supported native launcher controls
- `devhost` may proxy open/close interactions through the native controls
- `devhost` must not reparent, restyle wholesale, or otherwise assume ownership of the native panel contents

That boundary is what keeps the integration low-risk even when the host page includes multiple unrelated third-party toolbars.

## Unified TanStack shell

Mount the upstream `TanStackDevtools` in the host application and enable `[devtools.externalToolbars].enabled = true`. Devhost supplies one **TanStack** launcher for the attached native shell. Plugin navigation, live inspection, layout, and actions stay inside TanStack's workspace. Standalone Query and Router panels retain their separate toolbar entries; their plugins inside the unified shell do not create duplicate entries.

### Tested versions and host setup

The browser integration is verified in a development runtime with React/React DOM **19.2.5** and the following exact packages. [TanStack Devtools is alpha](https://tanstack.com/devtools/latest/docs/overview); its API and DOM contract can change between releases. Other releases require verification.

| Tool  | Host library                      | Devtools package                                                                  |
| ----- | --------------------------------- | --------------------------------------------------------------------------------- |
| Shell | —                                 | `@tanstack/react-devtools` **0.10.13** (`@tanstack/devtools` **0.15.0**)          |
| Form  | `@tanstack/react-form` **1.33.5** | `@tanstack/react-form-devtools` **0.2.34**                                        |
| Table | `@tanstack/react-table` **9.2.6** | `@tanstack/react-table-devtools` **9.2.5**                                        |
| Pacer | `@tanstack/pacer` **0.23.1**      | `@tanstack/react-pacer-devtools` **0.9.1** (`@tanstack/pacer-devtools` **1.6.0**) |

Install those packages in the host application. Use the native plugin factories with a stable plugin list:

```tsx
import { TanStackDevtools } from "@tanstack/react-devtools";
import { formDevtoolsPlugin } from "@tanstack/react-form-devtools";
import { tableDevtoolsPlugin } from "@tanstack/react-table-devtools";
import { pacerDevtoolsPlugin } from "@tanstack/react-pacer-devtools";
import { useState } from "react";

export function AppDevtools() {
  const [plugins] = useState(() => [formDevtoolsPlugin(), tableDevtoolsPlugin(), pacerDevtoolsPlugin()]);
  return <TanStackDevtools plugins={plugins} />;
}
```

Configure instrumentation in the application's real libraries:

- [Form](https://tanstack.com/form/latest/docs/framework/react/guides/devtools): create the form with `useForm({ formId: "profile", defaultValues: { name: "" } })` and use its native field handlers. The inspector receives actual form updates.
- [Table](https://tanstack.com/table/latest/docs/devtools): create a v9 table with `useTable`, native `tableFeatures`, and a unique `key`; call `useTanStackTableDevtools(table)`. The tested fixture uses `rowSelectionFeature` and verifies live selected rows in both native state views. The v8 `useReactTable` API is outside this tested setup.
- [Pacer](https://tanstack.com/pacer/latest/docs/devtools): create a keyed native utility, such as `new Debouncer(callback, { key: "save-profile", wait: 5000 })`, and call `maybeExecute` from application interactions. Native **Flush** executes that callback. Call `cancel()` during the application's unmount cleanup to stop pending work.

Devhost does not install host plugins, instrument libraries, replace native actions, or create a server connection for this integration. The tested shell uses its default browser event bus.

### Native controls and lifecycle

Discovery requires an attached native root containing both its persistent panel and native open trigger. A collapsed panel remains mounted; devhost reads its `data-open` state rather than treating presence as open. Toolbar actions re-query current roots and click native open/close controls. Native Escape, hotkeys, settings changes, and host remounts update toolbar availability and pressed state through DOM observation.

Only the shell's native opening and closing chrome is suppressed while aggregation is enabled. Plugin close buttons, controls, and content remain available. Disabling aggregation or unmounting devhost removes the suppression style and restores native chrome without changing panel state. Replacement triggers are suppressed while aggregation remains enabled.

URL-gated shells without the required flag and shells with `triggerHidden` have no toolbar entry. The native hotkey still opens a hidden-trigger shell; enabling its trigger through native Settings makes it available to devhost. TanStack's `config` initializes preferences; saved native settings take precedence on later mounts.

Multiple attached shells on the same page share upstream events and preferences. One **TanStack** entry reports whether an attached shell is open and proxies the upstream shared toggle; it does not assign independent shell identities. Same-origin tabs also share the upstream channel and local-storage preferences. Use separate project origins for separation: real browser tests verify that opening a shell on `127.0.0.1` leaves the shell on `localhost` closed. Devhost does not rewrite upstream channels or storage.

Native **Detach** moves the shell into TanStack's popup window. The parent-page toolbar entry disappears while the shell is detached because the native parent controls are absent. Close the popup to return the shell to its host page; devhost rediscovers it and reports its native open state. Devhost does not proxy controls into detached documents.

### Plugin and environment boundaries

Form 1.33.5 publishes updates when form state changes. A Form pane mounted after the form can be empty until the next field update; remounting that pane can repeat this boundary. Table registers its keyed instance when the devtools hook mounts. Form and Table remove their registrations when the host library components unmount.

Pacer 0.23.1 retains keyed utilities in its native registry and exposes no unregister/dispose API. Application cleanup cancels pending work, but the native inspector can retain an idle utility after host unmount. Devhost does not delete registry entries or synthesize lifecycle events.

These packages use `NODE_ENV=development` for their native event clients and default devtools panels. A `test` runtime intentionally selects native no-ops. This repository's Storybook browser checks run `NODE_ENV=development bun vitest run -c vitest.storybook.config.ts`; setting Vite's mode alone does not select that runtime. See [Vite's environment and mode distinction](https://vite.dev/guide/env-and-mode#node-env-and-modes).

Production opt-in is outside this tested integration. In Pacer devtools 0.9.1, the public React `/production` entry still imports the base core, which selects a no-op outside development; the test-mode browser probe confirms that no Pacer pane appears. Do not treat that entry as verified production support. Follow each upstream package's bundling guidance and verify any production use independently.

## React Hook Form

The integration is browser-tested against `@hookform/devtools` **4.4.0** with `react-hook-form` **7.89.0**. The upstream panel stays in the host page; `devhost` supplies only its toolbar launcher. Other devtools versions and the React Hook Form browser extension are outside this tested integration.

### Host setup

Install `react-hook-form` and `@hookform/devtools` in your application, then mount the upstream `DevTool` with your form's `control`. Enable `[devtools.externalToolbars]` in `devhost.toml`:

```toml
[devtools.externalToolbars]
enabled = true
```

```tsx
import { DevTool } from "@hookform/devtools";
import { useForm } from "react-hook-form";

export function ProfileForm() {
  const { control, register } = useForm({
    mode: "onChange",
    defaultValues: { email: "" },
  });

  return (
    <>
      <form aria-label="Profile">
        <label>
          Email
          <input {...register("email", { required: "Email required" })} />
        </label>
      </form>
      <DevTool control={control} placement="top-right" />
    </>
  );
}
```

### Multiple inspectors and lifecycle

Each mounted inspector gets a separate **Form 1**, **Form 2**, and subsequent launcher, in the order its panel is first discovered by the active `devhost` hook. The number identifies that panel instance; it is not a form name or the upstream `DevTool`'s `id` prop, which upstream uses for its browser extension. Open an inspector to see which form's fields it contains. Choose different upstream `placement` values when mounting multiple inspectors so their native panels do not overlap.

Each launcher opens or closes only its associated inspector. Native close-button clicks update that launcher's pressed state. Panel identities are stored in a hook-local weak map without modifying host attributes or retaining native launcher elements. Actions re-query live panels by identity. Reordering existing panels preserves their numbers; replacing or remounting a panel assigns a fresh number, and a removed identity cannot target the replacement. Unmounting the `devhost` hook ends that numbering session.

The 4.4.0 panel remains mounted while collapsed. Detection requires its React Hook Form header, native close control, field filter, and field expansion control together. Opening clicks that panel's sibling logo SVG, where 4.4.0 installs its native handler; closing clicks its native close button. Only native open buttons containing the React Hook Form logo are suppressed. Close buttons, inspector contents, live field values, and validation remain under upstream ownership.

Disabling aggregation or unmounting `devhost` removes the suppression style and restores native launchers without changing inspector state. Remounted native buttons continue to match the suppression selector while aggregation is enabled. If the React Hook Form browser extension makes `DevTool` render no panel, `devhost` exposes no form launcher.

See the [upstream setup reference](https://github.com/react-hook-form/devtools#quickstart) and the pinned [panel lifecycle](https://github.com/react-hook-form/devtools/blob/0486f0e6dd73a203600fc00611aebb6ac79b6e07/src/devToolUI.tsx), [open handler](https://github.com/react-hook-form/devtools/blob/0486f0e6dd73a203600fc00611aebb6ac79b6e07/src/logo.tsx), and [close control](https://github.com/react-hook-form/devtools/blob/0486f0e6dd73a203600fc00611aebb6ac79b6e07/src/header.tsx).

## Jotai

The native inspector is verified against `jotai-devtools` **0.14.0**, `jotai` **2.20.3**, and React/React DOM **18.3.1**, including custom stores, live atom values, snapshot recording, manual restoration, timed playback, multiple stores, and remount/removal. This isolated fixture uses React types **18.3.31**, installs with Bun, satisfies the installed React/Jotai peer ranges, and passes the normal TypeScript check. The [official 0.14.0 release](https://github.com/jotaijs/jotai-devtools/releases/tag/v0.14.0) is published on May 8, 2026 and declares peers `jotai >=2.20.0` and `react >=17.0.0`.

The repository's toolbar browser regressions additionally run with React **19.2.5** and pass live atoms, history/restoration/playback, multiple stores, and suppression cleanup. Upstream's `react-json-tree` 0.18.0 dependency declares React and React types peers through 18, despite the enclosing devtools package's broader range. React 19 is a tested runtime observation here, not a claim of upstream peer support. Check your package manager's peer policy when installing that combination.

Use 0.14.0 with Jotai 2.20.3 and React 18.3.1 for the typed host setup below. The 0.15.0 npm package declares `dist/index.d.mts` as its root TypeScript export but ships `dist/index.d.ts`; the normal TypeScript check fails with TS7016. It is outside this tested typed integration. Devhost supplies no declaration shim or package patch. Other versions require their own verification.

### Host setup

Install `jotai@2.20.3` and `jotai-devtools@0.14.0` in the host application. Import the upstream devtools module before creating a custom store so its native instrumentation runs first. Import its stylesheet in the host application and give `Provider` and `DevTools` the same store. Enable `[devtools.externalToolbars].enabled = true` in `devhost.toml`.

```tsx
import { DevTools } from "jotai-devtools";
import "jotai-devtools/styles.css";
import { atom, createStore, Provider, useAtom } from "jotai";

const countAtom = atom(0);
countAtom.debugLabel = "count";
const store = createStore();

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  return <button onClick={() => setCount((value) => value + 1)}>Count: {count}</button>;
}

export function App() {
  return (
    <>
      <Provider store={store}>
        <Counter />
      </Provider>
      <DevTools store={store} position="bottom-left" />
    </>
  );
}
```

This setup targets development builds: 0.14.0 renders no inspector in production. No toolbar entry appears when the upstream root is absent. Follow upstream guidance to exclude its devtools from production bundles. Devhost does not create or instrument stores, mount inspectors, or collect atom/history data.

### Multiple stores and lifecycle

Mount one upstream `DevTools store={store}` for each store to inspect. Each verified native root gets **Jotai 1**, **Jotai 2**, and subsequent launchers in encounter order within the active devhost hook. The number identifies the inspector root, not an atom label or store name. Open it to identify its store by the native atom list. Toolbar open/close actions and native minimize actions affect only that root; live values and time travel use the store selected by upstream.

The native root persists while its launcher and shell replace one another. Devhost detects the compound native launcher signature, or the native shell with its minimize control and Atom Viewer/Time travel tabs. It re-queries roots and controls for every action and stores only root identities in a weak map. Reordering preserves numbers. Removing or remounting an inspector gives its replacement a fresh number; stale IDs cannot control another store. Unmounting the devhost hook ends the numbering session.

Only native launcher buttons are suppressed. Native minimize controls, atom viewing, recording, history selection, restoration, playback, and panel layout remain under upstream ownership. Disabling aggregation or unmounting devhost removes the suppression style without changing native inspector state. Replacement launchers remain suppressed while aggregation is enabled.

Upstream uses fixed root/shell IDs and shared local-storage preferences, including its initial open state. Devhost scopes actions to individual roots despite those duplicate IDs; it does not rewrite IDs or storage. A remounted inspector can inherit the most recently persisted native open preference. The toolbar reports that observed state. Native panels can overlap when several are open; close one through its toolbar button to use another. Devhost does not reposition native panels or isolate upstream persistence/theme settings.

See the [official setup guide](https://jotai.org/docs/tools/devtools), and the npm release's pinned [provider and root lifecycle](https://github.com/jotaijs/jotai-devtools/blob/1de78d7536d5d2e1dd97bb2a9e66bd10a76fc068/src/DevTools/DevTools.tsx), [shell](https://github.com/jotaijs/jotai-devtools/blob/1de78d7536d5d2e1dd97bb2a9e66bd10a76fc068/src/DevTools/Extension/components/Shell/Shell.tsx), and [snapshot restoration](https://github.com/jotaijs/jotai-devtools/blob/1de78d7536d5d2e1dd97bb2a9e66bd10a76fc068/src/DevTools/Extension/components/Shell/components/TimeTravel/components/SnapshotDetail/components/DisplaySnapshotDetails/components/SnapshotActions.tsx).
