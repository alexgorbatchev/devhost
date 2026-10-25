---
title: "Native React DevTools"
---

Open Chrome's own React Developer Tools for the page you are on, straight from the devhost toolbar, and inspect props, state, and renders in its **Components** and **Profiler** tabs.

## Requirements

| Component                       | Version                                 |
| ------------------------------- | --------------------------------------- |
| Chrome                          | 154.0.8037.92 or newer                  |
| React Developer Tools extension | 8.0.0 or newer (the original extension) |
| React DOM in your app           | 19.2.5 or a newer React 19 release      |

Other browsers and versions are untested; the toolbar reports older or other versions as unsupported.

## Set up

1. Start Chrome with a remote-debugging port and a dedicated profile, which Chrome [requires for remote debugging](https://developer.chrome.com/blog/remote-debugging-port). The command name depends on your platform:

   ```sh
   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.cache/devhost-chrome"
   ```

2. In that profile, install [React Developer Tools](https://react.dev/learn/react-developer-tools) and allow its site access for your project's hostnames. Do this before loading your app.
3. Point devhost at the browser in `devhost.toml`. `[devtools.externalToolbars].enabled = true` is the default; setting it to `false` also turns off native React access.

   ```toml
   [devtools.externalToolbars]
   enabled = true

   [devtools.browser]
   endpoint = "http://127.0.0.1:9222"
   reactExtensionId = "fmkadmapgofadopljbjfkapdkoienihi"
   ```

4. Open your app in that profile through its devhost hostname.

Replace `9222` with your browser's port. An empty `endpoint` (the default) turns native access off. The endpoint must be one of:

- `http://<loopback IP>:<port>` with no path. devhost reads `/json/version` and accepts only a browser WebSocket on that same address and port.
- `ws://<loopback IP>:<port>/devtools/browser/<id>`, the browser's full WebSocket URL.

Hostnames such as `localhost`, non-loopback addresses, credentials, queries, fragments, redirects, TLS, and page WebSocket URLs are rejected.

`reactExtensionId` defaults to the Chrome Web Store ID shown above. Change it only when you load an unpacked build of the original extension, which gets its own ID; copy it from `chrome://extensions`.

## Use it

1. Choose **Connect browser control** in the toolbar. While connecting and connected, the same button reads **Disconnect browser control**.
2. When devhost finds your React app and the extension, a **React DevTools** button appears. Choose it to open Chrome DevTools for this page. It only opens the window; it is not a toggle.
3. Select the **Components** or **Profiler** tab there. devhost cannot select extension tabs for you.

The **Native browser control status** panel beside the button shows what devhost observes. Errors include a **Copy** action.

| Message                                                                                                            | Meaning                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Browser control is disconnected.**, **Connecting to the configured browser…**, **Browser control is connected.** | State of devhost's own connection to Chrome.                                                                                                                                         |
| **React host and extension detected.**                                                                             | Your page has a mounted React app and the configured extension is present. The devhost toolbar does not count.                                                                       |
| **A native DevTools window is present.**                                                                           | Chrome has a DevTools window for this page. It does not tell you which tab is selected or that inspection works.                                                                     |
| Any other message                                                                                                  | Something is missing, unsupported, or lost; the message names it. For example, the page is not open in that browser, several tabs claim the same page, or the extension is disabled. |

**Disconnect browser control** releases devhost's connection to Chrome. Your DevTools windows, extension, tabs, and profile stay as they are. Turning off external toolbars does the same. Collapsing the toolbar hides the button and status but keeps the connection and a compact status cue.

## Limitations

- Closing or replacing the native DevTools window while connected counts as a lost session. devhost withholds React access until you reload the page; reconnecting does not clear it. A manually reopened window has shown an empty or **Loading** tree.
- devhost never launches a browser, picks a port, looks at other profiles, or closes your windows.
- **Escape** does not disconnect or close DevTools.
- Only pages on your project's own routes can be controlled; routes with escaped characters or repeated slashes in their paths cannot.
- The controls carry no token: they are meant for trusted local development, and any script on the page's origin can use them.

All `[devtools.browser]` keys are in the [manifest reference](../../reference/devhost-example/); the rest of the toolbar is in the [devtools guide](../../guides/devtools/).
