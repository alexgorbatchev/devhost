---
title: "External Devtools"
---

The external devtools feature aggregates supported third-party launchers into the injected `devhost` overlay. Host-mounted integrations proxy native controls and hide only launcher chrome; the host library keeps its panels. The Redux integration opens the genuine upstream browser inspector in a separate owned window and connects explicitly registered real stores through upstream's public custom-transport seam.

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
    Adapter->>Host: Read current DOM or native host state
    Adapter-->>Hook: Installed adapters + open state
    Hook->>Style: Write selector-based hide rules
    Hook-->>UI: Launcher list snapshot

    Host->>Hook: MutationObserver(body subtree)
    Tool->>Adapter: Native state/application/metadata events
    Adapter->>Hook: Schedule synchronization
    Hook->>Adapter: Recompute installation/open state
    Hook->>Style: Update hide rules only if changed
    Hook-->>UI: Refresh button pressed state

    UI->>Hook: toggleLauncher(id)
    Hook->>Adapter: open() or close()
    Adapter->>Tool: Native control or supported selection API
    Tool->>Host: Render or collapse native panel
    Host->>Hook: MutationObserver(body subtree)
    Hook-->>UI: Refresh button pressed state
    Hook->>Adapter: Unsubscribe on disable/unmount
    Adapter->>Host: Remove only owned observers/styles
```

## How it works

### Adapter-Owned Host Knowledge

Each supported third-party tool is modeled as an `IExternalDevtoolsAdapter`. `externalDevtoolsDetectors.ts` registers the Query, Router, and unified TanStack shell adapters; the Form and Jotai detectors discover one adapter per mounted native inspector. `createVueDevtoolsDetector.ts` observes the existing Vue/Vite host. The feature-owned `reduxDevtools` detector observes explicit host registrations and its own native browser window/channel. `createExternalDevtoolsDetector.ts` combines current adapters and exposes an owned subscription/disposer to the generic hook. The hook resolves a launcher ID against current adapters before dispatching an action. Form/Jotai encounter identities remain local to the detector session across effect cleanup/re-subscription.

- `isInstalled()` answers whether the host page appears to have mounted the tool.
- `isOpen()` answers whether the native panel is currently expanded.
- `open()` and `close()` proxy native controls or supported native selection APIs.
- `hideSelectors` lists the host selectors whose launcher chrome should be hidden while `devhost` is aggregating that tool.

This keeps host-specific selectors and behavior in one place instead of spreading them through the panel component or the hook.

### Selector-Based Suppression

The feature does **not** remove host-owned nodes or keep mutable references to specific launcher elements. Instead, `useExternalDevtoolsLaunchers.ts` writes a narrowly scoped `<style>` tag into `document.head` with `display: none !important` rules derived from the installed adapters.

That approach is more resilient than mutating individual nodes because it survives:

- React or library-driven DOM replacement
- launcher state transitions between collapsed and expanded modes
- repeated host re-renders that recreate the native launcher elements

The native panel DOM remains untouched and fully owned by the third-party library.

Vue9's launcher is inside the upstream dock's open ShadowRoot, which a document stylesheet cannot reach. Its feature detector owns a constructed `CSSStyleSheet` adopted into that root. It targets only verified native dock-entry launcher markup with the unique current Vue entry title, covering floating and edge layouts. It does not hide the dock, panel, or iframe. Cleanup removes only that exact sheet from the current sheet list, preserving existing and later foreign sheets. See the native [adoptedStyleSheets contract](https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot/adoptedStyleSheets).

### Mutation Observation and Loop Prevention

Because these integrations depend on host-page DOM state, the hook observes `document.body` for subtree changes and recomputes the installed launchers whenever the host UI changes.

The observer intentionally avoids a full-document watch and batches recomputation behind `requestAnimationFrame`. It observes native open-state attributes, including the unified shell's `data-open`. The hide-style text is only rewritten when the selector set actually changes. Those guards prevent the injected feature from reacting to its own style updates and locking the page.

Body observation cannot see internal shadow-tree mutations. The Vue feature separately subscribes to published native panel, connection, trust, application, and existing dock shared-state events; it observes its native shadow roots for launcher replacement/title changes. Generation checks discard asynchronous responses after context replacement or cleanup. Disable, unmount, and React development StrictMode cleanup release these resources; re-enable and remount subscribe to the genuine current host again.

### UI Contract

`ExternalDevtoolsPanel.tsx` is only responsible for rendering the aggregated buttons and surfacing each launcher's current `isOpen` state.

- active buttons use the devtools primary button styling
- inactive buttons use the secondary styling
- button clicks always flow back through `toggleLauncher(id)` in the hook

This keeps the UI purely declarative while the adapters own the imperative host interactions.

### Safety Boundaries

Host-mounted aggregation is scoped to launchers, not panels.

- `devhost` may hide supported native launcher controls
- `devhost` may proxy open/close interactions through the native controls
- `devhost` must not reparent, restyle wholesale, or otherwise assume ownership of the native panel contents

That boundary is what keeps the integration low-risk even when the host page includes multiple unrelated third-party toolbars.

The separate Redux browser inspector uses the public upstream App unchanged. It owns its native panel layout and Emotion styles in its own document; no inspector stylesheet reaches the host page. Devhost owns only explicit producer registration, transport, setup feedback and its browser window lifecycle.

## Redux Toolkit and Zustand

The **Redux** toolbar entry opens full upstream Redux DevTools in a same-origin browser popup. Select registered store names to inspect live state and actions, use native history/time travel, and export state. It needs no desktop application, SocketCluster server, runtime Node service, or installed extension.

### Tested upstream contract

The browser frontend uses `@redux-devtools/app-core` **3.0.0** App with its documented caller-owned Redux store and custom transport, public `@redux-devtools/app` **8.0.0** `nonReduxDispatch`, React/ReactDOM **19.2.5**, React Redux **9.2.0**, Redux **5.0.1**, and native Emotion **11.14.0/11.14.1**. Host tests use Redux Toolkit **2.13.0**, instrument **3.0.0**, Zustand **5.0.15** with its unchanged devtools middleware, and browser extension **3.2.10** where installed. These are verified combinations; other releases require independent verification.

The maintained [app-core transport/store seam](https://github.com/reduxjs/redux-devtools/blob/89ae6ee57c6879c0da39d1f03d6ad8de029c5390/packages/redux-devtools-app-core/README.md), [non-Redux wire protocol](https://github.com/reduxjs/redux-devtools/blob/89ae6ee57c6879c0da39d1f03d6ad8de029c5390/docs/Integrations/Remote.md), [instrument EnhancedStore contract](https://github.com/reduxjs/redux-devtools/blob/89ae6ee57c6879c0da39d1f03d6ad8de029c5390/packages/redux-devtools-instrument/src/instrument.ts), and [Zustand StoreApi](https://github.com/pmndrs/zustand/blob/v5.0.15/src/vanilla.ts) define the integration boundaries. The registration functions below are devhost APIs around those public capabilities, not upstream registrars or automatic discovery of private extension sessions.

### Host registration

Enable `[devtools.externalToolbars].enabled = true`, visit the app through its devhost route, and opt into the served development module `/__devhost__/redux.js`. Register stable, nonempty ids and human-readable names. Keep registration out of production builds. This native browser module does not require publishing/installing the private devhost UI package. Inside this repository, the typed source export is `@alexgorbatchev/devhost-ui/redux`.

For a Toolkit host without existing native extension instrumentation, install `@redux-devtools/instrument@3.0.0` and instrument once. The following JavaScript setup targets a Vite development app:

```js
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { instrument } from "@redux-devtools/instrument";

const counter = createSlice({
  name: "counter",
  initialState: { count: 0 },
  reducers: {
    increment: (state) => {
      state.count += 1;
    },
  },
});
export const store = configureStore({
  reducer: counter.reducer,
  devTools: false,
  enhancers: (defaults) => defaults().concat(instrument()),
});

if (import.meta.env.DEV) {
  const moduleUrl = "/__devhost__/redux.js";
  const { registerReduxDevtoolsStore } = await import(/* @vite-ignore */ moduleUrl);
  const unregister = registerReduxDevtoolsStore({ id: "counter", name: "Counter", store });
  import.meta.hot?.dispose(unregister);
}
```

An existing Toolkit store configured with native extension DevTools can instead pass its actual returned store unchanged. The released **3.2.10** extension supplies the instrumented capability in the tested setup. Devhost verifies the real `liftedStore.getState/subscribe/dispatch` and lifted history before using it. Extension wrapper typings advertise a bare StoreEnhancer, so arbitrary extension versions are not guaranteed. Never add a second enhancer to an already instrumented store: upstream rejects double instrumentation. A plain store yields actionable setup feedback and is not replaced or recreated.

For Zustand, pass the actual vanilla StoreApi or bound store API configured with native `devtools`. Project data explicitly and restore a validated partial value through the existing StoreApi; this preserves action functions and middleware:

```js
import { createStore } from "zustand/vanilla";
import { devtools } from "zustand/middleware";

export const counterStore = createStore()(
  devtools(
    (set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 }), false, "counter/increment"),
    }),
    { name: "Counter", enabled: true },
  ),
);

if (import.meta.env.DEV) {
  const moduleUrl = "/__devhost__/redux.js";
  const { registerZustandDevtoolsStore } = await import(/* @vite-ignore */ moduleUrl);
  const unregister = registerZustandDevtoolsStore({
    id: "counter",
    name: "Counter",
    store: counterStore,
    snapshot: (state) => ({ count: state.count }),
    restore: (snapshot) => {
      if (
        typeof snapshot !== "object" ||
        snapshot === null ||
        !("count" in snapshot) ||
        typeof snapshot.count !== "number"
      ) {
        throw new Error("Counter replay requires numeric count.");
      }
      return { count: snapshot.count };
    },
  });
  import.meta.hot?.dispose(unregister);
}
```

Zustand's supplementary history begins at the current snapshot when this monitor connects. Real StoreApi updates appear as `zustand/setState`; its public subscription does not expose private middleware action labels or earlier native history. Reconnecting starts from the current state. Toolkit reads its actual existing lifted action history on attachment and reload.

### Native controls and serialization

Toolkit uses the same real lifted store for native jump/playback, reset, revert, commit, skip/sweep, reorder, lock, pause, export, and imported lifted history. Zustand supports native jump/playback, reset, revert, commit, and export of its projected history; unsupported optional skip/reorder/lock/pause/import controls are disabled by upstream feature configuration. No arbitrary action evaluation or JavaScript function reconstruction is offered.

Upstream JSAN **3.1.14** serialization carries projected data, including tested Date, Map, Set, undefined, and cyclic references, over MessageChannel as strings. Snapshot/restore functions define each host's data boundary. Exclude executable functions and validate replay data before applying it. Redux imported state must be compatible with the real reducer; importing executable functions is unsupported. Snapshot or replay errors produce setup feedback without replacing host actions or throwing a snapshot error through an ordinary host state update. A later successful update or corrected registration recovers the connection.

### Availability, sessions, and cleanup

A hook-bearing or unrelated page with no explicit stores has no Redux entry. Registered missing capabilities show a setup message. The button's pressed state follows the actual owned Window; its title distinguishes a connected store count, a window awaiting transport, and unavailable setup or popup denial. Allow popups and compatible same-origin opener policies. CSP that blocks the host SDK or injected script prevents setup; sandbox popup denial yields an actionable message. Independently navigating to the native monitor shows setup guidance with no connected host instances. Browser policies that sever the opener are outside this delivery contract; devhost does not fabricate a connection or weaken them.

Every registration has a unique native connection id. Re-registering a stable host id replaces its producer; an older unregister handle cannot remove the replacement. HMR should dispose its current handles. Disabling aggregation, unmounting, or host navigation closes the owned monitor, channels, timer and producer subscriptions. It preserves host stores, native middleware, extension hooks/listeners and other tools. React development StrictMode cleanup/re-subscription and positive remount recovery use the same real registration state. Reloading a monitor exchanges a fresh channel; browser closure and the owned close watcher reclaim it before reopening.

Concurrent projects use their own routed origins, host windows, registrations, monitor windows and channels. Tests verify two actual devhost instances through native Caddy, including HTTPS and an app page under `/project-b/`; reserved control/module URLs remain at the origin root. That validation uses isolated Caddy storage, allocated listener/admin ports, the supported `skip_install_trust` option and an owned browser that ignores the fixture certificate. It proves routing, shipped injection/assets and native store connectivity, not system trust installation. Hosts must retain the normal devhost control-route mapping; arbitrary proxies that strip `/__devhost__/` are not covered.

### Installed-extension boundaries

The existing released extension continues recording and replaying before, during, and after devhost attachment. Devhost neither overwrites its hook/listeners nor calls shared disconnect or middleware cleanup. Each upstream monitor keeps its own cursor: the released [pageScript handler](https://github.com/reduxjs/redux-devtools/blob/1c5df1ee3275612c34e8ad37dd58537c83d5e885/extension/src/pageScript/index.ts) deliberately omits broadcast while time traveling, paused, or locked. Do not interpret another monitor's cursor as the current host state. Native extension controls continue to write the actual store; ordinary new actions update its history.

Cold native Zustand metadata/history can be incomplete when the extension frontend opens after stores were created. The same limitation occurs with aggregation disabled. The verified coexistence sequence opens the genuine empty native frontend first, then creates the real stores; native names/history and replay work before, during, and after devhost attachment. This integration does not repair upstream cold history or claim private session enumeration.

## Vue DevTools

Devhost supplies one **Vue** launcher for the host-installed Vue DevTools inspector. Components, live component state, page selection, settings, and other Vite tools remain in the native host. Devhost does not install Vue instrumentation, mount an inspector, or replace the host's dock registration.

### Verified host setup

The supported combination is `vite-plugin-vue-devtools` **9.0.0-beta.1**, Vue **3.5.43**, Vite **8.3.3**, `@vitejs/plugin-vue` **6.0.9**, and `@vitejs/devtools` / `@vitejs/devtools-kit` **0.7.6**, resolving `@devframes/hub`, `@devframes/hub-ui`, and `devframe` **1.2.2**. Vue9 is a beta release whose native host and markup can change. Other versions, including stable plugin 8.2.1's different overlay, need their own verification; they are outside this integration. This host setup does not change devhost's repository Vite **7.3.1** or require unrelated applications to upgrade.

Install those packages in the Vue host and enable the genuine Vite DevTools host alongside the Vue plugin, following the [official Vue plugin setup](https://devtools.vuejs.org/guide/vite-plugin):

```js
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";

export default defineConfig({
  plugins: [vue(), vueDevTools()],
  devtools: { apply: "serve" },
});
```

Enable `[devtools.externalToolbars].enabled = true` in `devhost.toml`. Reveal a passive/hidden native host with **Alt+Shift+D**, select its **Unauthorized** control, and enter the actual code printed by the host. Devhost does not bypass authorization. The **Vue** entry appears only after native trust, a visible embedded dock, a registered Vue iframe entry, and a real mounted Vue application are present. Merely installing Vite tools or loading their dock on an unrelated non-Vue page does not qualify.

### Native state, ownership, and cleanup

The detector uses published `getDevframeClientContext()` from `@devframes/hub/client`, the getter used by the verified host. Kit 0.7.6's `getDevToolsClientContext()` reads a different global and returns undefined in this host; devhost supplies no alias or fabricated context. Vue's existing runtime kit supplies application snapshots and lifecycle events. Devhost reads these objects without installing or disposing the host's kit or hooks.

Open and close call native `docks.switchEntry("vue-devtools")` and `docks.switchEntry(null)`. Pressed state requires native panel state **open** and selected dock **vue-devtools**. Native Escape, selecting another tool, hiding/revealing the dock, and page component selection update that state through native events. Starting the page locator temporarily closes Vue; selecting the real page component restores the native inspector and toolbar state.

The Vue launcher suppression sheet follows current entry title, native root replacement, and floating/edge layout changes. Server metadata replacement, field removal, entry removal/re-registration, client overrides, and later forced client registration remain upstream-owned. Cleanup restores native launcher visibility without reverting metadata, disposing registrations, changing the selected panel, or removing foreign sheets. Native Settings remains usable. Disabling/remounting devhost and StrictMode effect cleanup/re-subscription preserve these contracts and recover live inspection.

The title must be unique among native dock entries for the verified launcher selector to identify Vue. A collision suppresses neither launcher and removes the aggregate Vue entry; a later unique title restores availability. Native `when`/`visibility` conditions, hidden dock state, missing roots, revoked trust, or application unmount likewise remove availability and the owned sheet. Recovery is observed from the real host. The button's title reports the native connection status; it is not inferred from iframe presence.

Shared-state observation starts only when the host is trusted and `devframe:docks` already exists in its published cache. In devframe 1.2.2, requesting a missing state before authorization creates a deferred state object; initializing a competing object can leave the native UI holding stale metadata. Devhost never initializes that registry, overrides native listeners, or claims host registration ownership. Async subscriptions and application queries carry generation checks so cleanup cannot install a late listener or sheet.

### Project and delivery boundaries

Native browser regressions verify actual Components/live state/page selection, normal/passive/hidden hosts, unrelated pages, application mount/unmount, metadata replacement, title collision/recovery, native root/layout replacement, foreign sheets, and devhost disable/unmount/remount. Independent host servers on separate origins, including a `/project-b/` Vite base, preserve separate state and launcher selection. Use separate public project origins: the upstream host keeps geometry in origin local storage and selection in tab session storage; devhost does not rewrite upstream channels or preferences.

The supported integration is the attached embedded host. Devhost does not control detached documents or advertise a standalone-only host as attached. Runtime state and resources stay local to the host document and active detector; no global project port or browser session is shared by devhost's detector.

Compiled-bundle validation also verifies two simultaneously running devhost projects through separate public HTTP/HTTPS hostnames, including the Vite base path, native authorization, live Components state, and independent selection with `proxyLocalOrigin = true`. The fixture's manually rendered toolbar is removed for that check. The isolated validation Caddy uses supported test-only `skip_install_trust`, `http_port`, and `https_port` globals and a private browser that accepts its untrusted certificate. This proves native routing, injection, and inspection; it does not verify unmodified managed CA trust installation. No test override changes the app generator or the Vue host contract.

Published native contracts are pinned in [Vue's host client and instrumentation](https://github.com/vuejs/devtools/blob/e69a502d2a800da79ded86cb9847b2bcb922aec5/packages/vite/src/client.ts), [hub getter](https://github.com/devframes/devframe/blob/56caf88d5498e60b46904441d20d28b533886d99/packages/hub/src/client/context.ts), [dock APIs](https://github.com/devframes/devframe/blob/56caf88d5498e60b46904441d20d28b533886d99/packages/hub/src/client/docks.ts), and [native launcher markup](https://github.com/devframes/devframe/blob/56caf88d5498e60b46904441d20d28b533886d99/packages/hub-ui/src/client/components/dock/DockEntry.vue).

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
