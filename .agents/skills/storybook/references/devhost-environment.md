# Storybook & Vite Devhost Environment Integration Guide

When working with Storybook, Vitest, or Vite-style dev servers in the `devhost` HTTPS-routed development environment, you must adhere to the following configurations and boundaries.

## 1. Vite Security Feature: "Allowed Hosts" (`server.allowedHosts`)

Vite v6+ blocks requests from unrecognized `Host` headers to prevent DNS rebinding attacks. When a Vite-powered app is accessed via a custom `devhost` domain (e.g. `devhost.localhost`), Vite will reject the connection.

### Storybook (Vite-based)
- `devhost.toml` passes the dynamic routed domain via `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = "{{ env.DEVHOST_STORYBOOK }}"`.
- `.storybook/main.ts` parses this environment variable and merges it into Storybook's `core.allowedHosts` and Vite's `server.allowedHosts` inside the `viteFinal` hook:
  ```typescript
  viteFinal(existingConfig) {
    if (storybookAllowedHosts.length === 0) return existingConfig;
    return mergeConfig(existingConfig, {
      server: { allowedHosts: storybookAllowedHosts },
    });
  }
  ```

### General Vite & Astro Apps
- Configure `server.allowedHosts: true` (or specify explicit hosts) in local configurations to allow routed proxy requests (as seen in `packages/docs/astro.config.mjs`).

---

## 2. Vite Bind-Host IPv6 Mismatch (`bindHost`)

By default, `devhost` proxies to `127.0.0.1` (IPv4). However, many modern machines resolve `localhost` and Vite dev servers to `::1` (IPv6 loopback). This mismatch results in `devhost` routing failing even if direct access to the port works.

- **Requirement**: If a Vite app binds to IPv6 loopback, you must set `bindHost = "::1"` explicitly in the `devhost.toml` service manifest:
  ```toml
  [services.app]
  command = ["bun", "run", "dev"]
  port = 5173
  bindHost = "::1"
  ```
- *Note*: `devhost` will emit a CLI warning on startup if it detects a bind-host mismatch.

---

## 3. Command Port Expansion ($PORT)

- **Requirement**: `devhost` injects the selected service port as the `PORT` environment variable. This does not expand `"$PORT"` within raw argument lists. To pass the dynamic port to Storybook, you must wrap the command in an explicit shell:
  ```toml
  command = ["sh", "-c", "exec ./node_modules/.bin/storybook dev --ci --port \"$PORT\""]
  ```

---

## 4. Standalone Storybook Mock Environment

When running Storybook standalone, the `devhost-ui` React components cannot reach the actual Go supervisor endpoints. To keep stories runnable, `.storybook/preview.tsx` sets up robust mock providers:

- **Config Injection**: Injects mock `IInjectedDevtoolsConfig` into `globalThis[DEVTOOLS_INJECTED_CONFIG_GLOBAL_NAME]`.
- **Fetch Mocking**: Intercepts REST queries (such as terminal start sessions) to return simulated JSON IDs.
- **WebSocket Mocking**: Overrides `globalThis.WebSocket` with a `MockStorybookWebSocket` class that emits compliant status snapshot frames (for health streams, mock tailing logs, and terminal input/output interaction).

When modifying or adding new UI dependencies on the Go supervisor, always update `.storybook/preview.tsx` to preserve mock correctness.

---

## 5. Vitest Browser Mode Optimization

Storybook play tests are executed in a headless browser via Playwright and Vitest browser mode. 

- **Pre-bundling**: To avoid bundling/compilation delays during high-speed tests, pre-bundle key dependencies in `optimizeDeps.include` in both `vite.config.ts` and `vitest.storybook.config.ts`.
- **Test Port Isolation**: Vitest starts a temporary Storybook server on a dedicated isolated port (`process.env.DEVHOST_UI_STORYBOOK_TEST_PORT` defaulting to `6106`) with `--ci` to avoid port clashing with developers' dev servers.
