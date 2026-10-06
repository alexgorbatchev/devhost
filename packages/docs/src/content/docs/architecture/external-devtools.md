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

Each supported third-party tool is modeled as an `IExternalDevtoolsAdapter` under `src/devtools/features/externalDevtoolsPanel/`. `externalDevtoolsDetectors.ts` registers the Query and Router adapters; `createReactHookFormDevtoolsDetector.ts` and `createJotaiDevtoolsDetector.ts` discover one adapter per mounted native inspector. The hook combines those adapters on every synchronization and resolves a launcher ID against the current adapters before dispatching an action.

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

The observer intentionally avoids a full-document watch and batches recomputation behind `requestAnimationFrame`. The hide-style text is only rewritten when the selector set actually changes. Those guards prevent the injected feature from reacting to its own style updates and locking the page.

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

The integration is browser-tested against `jotai-devtools` **0.14.0**, `jotai` **2.20.3**, and React **19.2.5**, including custom stores, live atom values, snapshot recording, manual restoration, and timed playback. The [official 0.14.0 release](https://github.com/jotaijs/jotai-devtools/releases/tag/v0.14.0) is published on May 8, 2026 and declares peers `jotai >=2.20.0` and `react >=17.0.0`.

The fixture installs with Bun and passes this workspace's normal typecheck. Upstream's `react-json-tree` 0.18.0 dependency declares React peers through 18, despite the enclosing devtools package's broader range. The tested React 19 runtime passes the covered interactions; check your package manager's peer policy when installing this combination.

Use this exact tested combination for the typed setup below. The 0.15.0 npm package declares `dist/index.d.mts` as its root TypeScript export but ships `dist/index.d.ts`; the normal TypeScript check fails with TS7016. It is outside this tested typed integration. Devhost supplies no declaration shim or package patch. Other versions require their own verification.

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
