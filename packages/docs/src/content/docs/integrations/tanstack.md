---
title: "TanStack devtools"
---

devhost puts **Query**, **Router**, and **TanStack** toggles in its toolbar for the TanStack devtools your app mounts, and hides their floating launcher buttons. The panels stay TanStack's own.

## Requirements

| Tool                | Host library                          | Devtools package                                                                  |
| ------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| Query (standalone)  | `@tanstack/react-query` **5.99.0**    | `@tanstack/react-query-devtools` **5.99.0**                                       |
| Router (standalone) | `@tanstack/react-router` **1.168.21** | `@tanstack/react-router-devtools` **1.166.13**                                    |
| Unified shell       | —                                     | `@tanstack/react-devtools` **0.10.13** (`@tanstack/devtools` **0.15.0**)          |
| Form plugin         | `@tanstack/react-form` **1.33.5**     | `@tanstack/react-form-devtools` **0.2.34**                                        |
| Table plugin        | `@tanstack/react-table` **9.2.6**     | `@tanstack/react-table-devtools` **9.2.5**                                        |
| Pacer plugin        | `@tanstack/pacer` **0.23.1**          | `@tanstack/react-pacer-devtools` **0.9.1** (`@tanstack/pacer-devtools` **1.6.0**) |

Tested with React 19 in development builds (`NODE_ENV=development`); other versions are untested. [TanStack Devtools is alpha](https://tanstack.com/devtools/latest/docs/overview), so its behavior can change between releases.

## Set up

1. Keep `[devtools.externalToolbars].enabled = true` (the default) in `devhost.toml`.
2. For the standalone panels, mount TanStack Query or Router devtools in your app as their docs describe.
3. For the unified shell, install the packages above and mount `TanStackDevtools` with a stable plugin list:

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

4. Instrument the libraries you use:
   - [Form](https://tanstack.com/form/latest/docs/framework/react/guides/devtools): create the form with an ID, for example `useForm({ formId: "profile", defaultValues: { name: "" } })`.
   - [Table](https://tanstack.com/table/latest/docs/devtools): create a v9 table with `useTable`, `tableFeatures`, and a unique `key`, then call `useTanStackTableDevtools(table)`. The v8 `useReactTable` API is untested.
   - [Pacer](https://tanstack.com/pacer/latest/docs/devtools): create keyed utilities, for example `new Debouncer(callback, { key: "save-profile", wait: 5000 })`, and call `cancel()` when the component unmounts.

## Use it

Each toolbar entry opens and closes its panel. Escape, TanStack's hotkeys, and its own close buttons keep the toolbar's pressed state in step. Query and Router plugins inside the unified shell do not get separate entries. Setting `[devtools.externalToolbars].enabled = false` brings the native launchers back without opening or closing any panel.

**Detach** moves the shell into TanStack's popup window, and the **TanStack** entry disappears until you close the popup.

## Limitations

- A shell with `triggerHidden`, or a URL-gated shell without its flag, has no entry. Its hotkey still works, and turning the trigger on in TanStack's Settings brings the entry back.
- Saved TanStack settings override `config` on later mounts.
- Several shells on one page share one **TanStack** entry and one toggle. Tabs on the same origin share state and preferences too; use separate hostnames to keep projects apart.
- A Form pane opened after the form mounted can stay empty until the next field change.
- Pacer has no unregister API, so an idle utility can stay in the inspector after its component unmounts.
- In a `test` runtime the packages render nothing. Vite's `--mode` does not set `NODE_ENV`; see [Vite's env and modes](https://vite.dev/guide/env-and-mode#node-env-and-modes).
- Production builds are unsupported, including Pacer's `/production` entry, which renders nothing outside development.
- devhost does not install plugins or instrument your libraries.
