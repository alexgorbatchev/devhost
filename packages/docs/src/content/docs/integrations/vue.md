---
title: "Vue DevTools"
---

devhost adds a **Vue** toolbar entry that opens and closes the Vue DevTools panel in your Vite DevTools dock. Components, live state, page selection, and settings stay in Vue's own panel.

## Requirements

| Package                                                      | Tested version |
| ------------------------------------------------------------ | -------------- |
| `vite-plugin-vue-devtools`                                   | 9.0.0-beta.1   |
| `vue`                                                        | 3.5.43         |
| `vite`                                                       | 8.3.3          |
| `@vitejs/plugin-vue`                                         | 6.0.9          |
| `@vitejs/devtools`, `@vitejs/devtools-kit`                   | 0.7.6          |
| `@devframes/hub`, `@devframes/hub-ui`, `devframe` (resolved) | 1.2.2          |

Other versions are untested, including the stable plugin 8.2.1, which uses a different overlay. Version 9 is a beta, so its dock can change. Your other projects do not need to upgrade Vite.

## Set up

1. Install the packages above in your Vue app and enable the Vite DevTools host next to the Vue plugin, following the [official setup](https://devtools.vuejs.org/guide/vite-plugin):

   ```js
   import { defineConfig } from "vite";
   import vue from "@vitejs/plugin-vue";
   import vueDevTools from "vite-plugin-vue-devtools";

   export default defineConfig({
     plugins: [vue(), vueDevTools()],
     devtools: { apply: "serve" },
   });
   ```

2. Keep `[devtools.externalToolbars].enabled = true` (the default) in `devhost.toml`.
3. Open the app through its devhost hostname. If the dock is hidden, press **Alt+Shift+D** to show it.
4. Select the dock's **Unauthorized** control and enter the code Vite prints in your terminal. devhost does not bypass this step.

The **Vue** entry appears once the dock is authorized and visible, Vue's dock entry is registered, and a Vue app is mounted. A page with the Vite dock but no Vue app gets no entry.

## Use it

Choose **Vue** to open or close the Vue panel. Escape, switching dock tools, hiding the dock, and picking a component on the page keep the pressed state in step. Starting the page locator closes Vue briefly; picking a component reopens it. The entry's tooltip shows Vue DevTools' connection status.

Setting `[devtools.externalToolbars].enabled = false` brings back the dock's own Vue launcher without changing the selected panel.

## Limitations

- Only the dock embedded in your page is supported; devhost does not control detached DevTools windows.
- The Vue dock entry's title must be unique among dock entries. On a collision, devhost hides neither launcher and shows no **Vue** entry until the title is unique again.
- The entry disappears while the dock is hidden, its visibility conditions are unmet, authorization is revoked, or the Vue app unmounts.
- The dock keeps its position in local storage and its selection in session storage per origin. Give each project its own hostname to keep them apart.
- devhost does not install Vue instrumentation, mount an inspector, or change the dock's registrations.
