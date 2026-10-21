---
created_on: 2026-10-20 20:36
last_modified: 2026-10-21 01:33
status: current
---

# Assistant-ui component library

This reference records component ownership and integration constraints for devhost's browser chat, page selection, and annotated tab capture.

## Ownership and source

The component library belongs to the shared `ui-design/shadcn` workspace, published as `@alexgorbatchev/shadcn`. Its source comes from the [assistant-ui registry](https://r.assistant-ui.com/registry.json), including the entire [Elements showcase](https://www.assistant-ui.com/elements). The shared library owns the adapted source under `src/components/assistant-ui/elements/` and `src/components/assistant-ui/native/` and retains upstream attribution in `THIRD_PARTY_NOTICES.md`.

The component code follows the shared library's TypeScript, React, formatting, lint, and test rules. There is no vendor lint exclusion. Component families, hooks, and nonvisual logic have separate owners. Preserve actual assistant-ui runtime primitives when changing runtime-connected components; keep presentation components independent of a particular harness transport.

The registry's server/API starter templates are not component-library dependencies. Installing the component library does not configure a model provider, request an API key, or connect a harness. Devhost's chat integration owns those connections.

The shared library exports `@alexgorbatchev/shadcn/assistant-ui`, `@alexgorbatchev/shadcn/assistant-ui/native`, individual component subpaths, and `@alexgorbatchev/shadcn/assistant-ui.css`. Elements receive caller data; native components connect to assistant-ui's runtime. Prefer individual subpaths when only part of the catalog is needed; the convenience barrels reference the full feature's optional peers. Internal render helpers are not intended public entrypoints.

Devhost imports the shared library rather than maintaining a second component copy. Its `agentChat` feature owns native harness transport and runtime adaptation; `annotationComposer` owns element selection, and `visualAnnotations` owns drawings and tab capture.

The Go-side bundle builder resolves the existing main and Redux entrypoints from the UI package's exports. Component entrypoints are library boundaries rather than additional served scripts. Keep unused showcase dependencies out of a consumer's import graph, while retaining required styles and registration when the owning component is used. Verify this with actual consumer builds, including both small components and components with runtime registration.

## Styling and injection

Use the shared library's native Base UI controls, semantic tokens, and density conventions. Devhost integration must preserve readable light and dark states and isolation from the host page.

`src/devtools/shared/devtools.css` imports the shared theme and assistant-ui styles and scans the UI package's installed `node_modules/@alexgorbatchev/shadcn/dist`. Keep React and React DOM type-package versions aligned with the shared library: differing type peers can cause Bun to install separate assistant-ui context instances even when their runtime versions match. The native tab-capture acceptance renders the actual bundled runtime and catches missing-provider failures that a deduplicated development server can hide.

The shared `PortalProvider` supplies the container for container-aware overlay portals. Pass the actual container inside the mounted devtools Shadow DOM when composing chat. Without the provider, native standalone portal behavior applies; that is unsuitable for injected devtools because the overlay would leave the styled shadow tree. Do not copy devtools CSS into `document.head` to compensate.

The provider accepts `container` and `children`. Keep that container within the existing top-layer devtools root so overlays share its lifecycle and stacking context. Separate mounted devhost instances must receive their own containers.

The upstream native `SelectionToolbarPrimitive` is an exception: it portals directly into `document.body` and uses document text selection. The reskinned `SelectionToolbar` supports ordinary DOM mounting, not styled shadow-root mounting. Devhost's page selector is a separate feature; do not use this optional chat-text toolbar as its implementation.

`DotMatrix` and `NumberRoll` use element-scoped Web Animations. They cancel owned animations on replacement or unmount and respect the browser's reduced-motion preference. They do not register custom properties or insert styles in the host document. Number formatting uses `Intl.NumberFormat`, preserving locale-specific symbols and stable digit-place identities as the number grows or shrinks.

Runtime primitives consume actual caller data. Fake message feeds and generated example waveforms belong in stories, not runtime timers. A display component's animation may illustrate the state supplied by its caller; it must not invent agent activity.

Context usage reports provider counts independently; cached input and reasoning counts may overlap the provider's input and output counts. The native context display reads assistant-ui message metadata. Its last total survives partial streaming updates within a conversation and resets when the conversation identity changes. Native meters expose bounded utilization, while the text retains the actual reported total.

## Harness integration evidence

The configured local harnesses expose model discovery without an inference request or new API keys. A local protocol probe initialized the installed `codex app-server` and received seven entries from `model/list`; a separate probe initialized the installed `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` process and received five model entries. Both owned probe processes were stopped afterward. These counts describe this environment, not defaults for the UI.

Codex's [app-server protocol](https://learn.chatgpt.com/docs/app-server) uses `initialize`, followed by `initialized`, then `model/list`. Consume every page using `nextCursor` and retain the returned model identifier, display name, default selection, and capabilities. The installed CLI can generate the authoritative JSON schemas with `codex app-server generate-json-schema`.

Claude's [Agent SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript) documents the initialization response's `models` list. The maintained SDK's exported wire types specify a `control_request` envelope with `request_id` and `request: { subtype: "initialize" }`; the corresponding `control_response` contains the initialization payload. Use the returned model `value` and `displayName`. Preserve the configured CLI's settings and authentication. Do not use `--bare`, which intentionally skips that configuration.

The Go chat tests exercise conversation commands, permission responses, image validation, cancellation, process cleanup, session isolation, and native command receipts. Browser hook tests cover reconnects and draft recovery. Native tab-capture acceptance sends an actual annotated browser PNG, checks that chat chrome is absent, and verifies capture tracks stop. A real Codex conversation probe also returned a reply. Live Claude inference remains unverified in this environment because the configured CLI reports that login is required; native initialization, model reset, user replay, and error delivery are verified separately.

## Verification

Run focused component stories and required full validation in the shared library's workspace. Devhost integration separately requires `just ui check` and affected Go checks. Changes to dependencies or directory layout also require root `just check`. Format through each repository's root `just fix`. Shared-library checks do not prove that browser chat, harness execution, or annotated tab capture works in devhost.

Stories exercise native interactions and meaningful component states. Test callbacks, rejection and retry, selection limits, disabled states, keyboard focus, and the actual assistant-ui runtime where a component requires it. Light/dark injection tests verify computed contrast and that portaled content stays in the same shadow root as its trigger. A screenshot or a component merely importing does not establish those behavior contracts.

Run browser verification serially within one checkout: concurrent Storybook Vitest runs share the optimized dependency cache, even when their server ports differ. A separate server port alone does not isolate that cache.

Keep each workspace's Storybook dependency optimization consistent with its own configuration. Verify cold loading; a warmed-cache retry does not fix a dependency reload race.

## Updating upstream source

Inspect the registry entry and its dependency closure before replacing a component. Reconcile changes with the local owning components, native primitives, semantic tokens, and overlay-container contract; do not overwrite local adaptations with a registry install. Preserve license attribution and review updated imports against the installed dependency versions.

For a behavior change, establish a failing behavioral test, implement the change, and rerun it. Temporarily disable the changed behavior and confirm the regression test fails, then restore the implementation. Keep tests and validation enabled while adding components that the current chat surface does not yet use.
