---
title: "Jotai"
---

devhost adds a **Jotai 1**, **Jotai 2**, … toolbar entry for each Jotai DevTools panel on your page and hides the panels' floating launchers. Atom viewing and time travel stay in Jotai's panel.

## Requirements

| Package              | Tested version |
| -------------------- | -------------- |
| `jotai-devtools`     | 0.14.0         |
| `jotai`              | 2.20.3         |
| `react`, `react-dom` | 19.3.1         |

Other versions are untested. `jotai-devtools` 0.15.0 fails TypeScript checks (TS7016) because its package points at a type file it does not ship.

`jotai-devtools` depends on `react-json-tree` 0.18.0, which declares React peers only up to 18, so your package manager may warn about React 19 or refuse to install without allowing it.

## Set up

1. Install `jotai@2.20.3` and `jotai-devtools@0.14.0` in your app.
2. Keep `[devtools.externalToolbars].enabled = true` (the default) in `devhost.toml`.
3. Import `jotai-devtools` before you create a custom store, import its stylesheet, and give `Provider` and `DevTools` the same store:

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

4. Mount one `DevTools store={store}` for each store you want to inspect.

`jotai-devtools` renders nothing in production builds. Follow the [official guide](https://jotai.org/docs/tools/devtools) to keep it out of production bundles.

## Use it

Each entry opens and closes one panel. Entries are numbered in the order devhost finds the panels, not by store name; check a panel's atom list to see which store it shows.

Setting `[devtools.externalToolbars].enabled = false` brings back the native launchers without opening or closing any panel.

## Limitations

- Reordering panels keeps their numbers. A removed or remounted panel gets a new number, and numbering starts over when the page reloads.
- All panels share Jotai's saved preferences, so a remounted panel can open in the last saved state.
- Open panels can overlap; close one from the toolbar to reach another. devhost does not reposition panels.
- `jotai-devtools` 0.14.0 logs a tree-shaking deprecation warning in development, even with the recommended setup.
- devhost does not create or instrument stores or collect atom data.
