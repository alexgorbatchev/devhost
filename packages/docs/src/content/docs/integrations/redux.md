---
title: "Redux Toolkit and Zustand"
---

The **Redux** toolbar entry opens the full Redux DevTools inspector in a popup for the stores you register, with no extension, desktop app, or server to install.

## Requirements

| Package                                     | Tested version |
| ------------------------------------------- | -------------- |
| `@reduxjs/toolkit`                          | 2.13.0         |
| `@redux-devtools/instrument`                | 3.0.0          |
| `zustand`                                   | 5.0.15         |
| Redux DevTools browser extension (optional) | 3.2.10         |

Other versions are untested. The browser must allow popups from your app's origin.

## Set up

1. Keep `[devtools.externalToolbars].enabled = true` (the default) in `devhost.toml`.
2. Open your app through its devhost hostname, which serves the registration module at `/__devhost__/redux.js`.
3. Register each store from development code only, with a stable, nonempty `id` and a readable `name`.

### Redux Toolkit

If the store has no Redux DevTools instrumentation yet, install `@redux-devtools/instrument@3.0.0` and add it once. This example targets a Vite app:

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

A store already set up for the Redux DevTools extension can be registered as is. Never add `instrument()` to it as well: Redux DevTools rejects double instrumentation. A plain store without either gets a setup message in the toolbar.

### Zustand

Pass a store created with Zustand's `devtools` middleware. `snapshot` chooses the data the inspector shows; `restore` validates replayed data and returns the partial state to apply, so your actions and middleware stay intact:

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

## Use it

Choose **Redux** to open the inspector and pick a store by name to inspect state and actions, time travel, or export. The button stays pressed while the popup is open; its tooltip shows how many stores are connected, or why none are.

| Controls                                      | Redux Toolkit | Zustand  |
| --------------------------------------------- | ------------- | -------- |
| Jump, playback, reset, revert, commit, export | Yes           | Yes      |
| Skip and sweep, reorder, lock, pause, import  | Yes           | Disabled |

Registering the same `id` again replaces the earlier registration; dispose the returned `unregister` on hot reload as the examples do. Navigating away, turning off external toolbars, or unmounting the toolbar closes the popup and leaves your stores untouched.

## Limitations

- Pages with no registered stores have no **Redux** entry.
- Zustand history starts when the inspector connects, and updates appear as `zustand/setState` without your middleware action names. Redux Toolkit shows the store's full existing history.
- Data is serialized: `Date`, `Map`, `Set`, `undefined`, and cyclic references survive; functions do not. Imported Redux state must fit your reducer. The inspector cannot evaluate arbitrary actions.
- A `snapshot` or `restore` error shows a setup message without breaking your app. The next successful update or a corrected registration reconnects.
- Blocked popups, a CSP that blocks the module or toolbar script, and opener policies that cut the popup off from your page prevent a connection. devhost does not weaken them.
- A proxy in front of devhost that strips `/__devhost__/` breaks the integration.
- The Redux DevTools extension keeps working alongside. Each inspector keeps its own position in history, so another inspector's cursor is not your app's current state.
- The extension can show incomplete Zustand history if its panel opened after the stores were created, with or without devhost. Open its panel before loading the app.
