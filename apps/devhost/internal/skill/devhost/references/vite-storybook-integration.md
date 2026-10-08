# Vite and Storybook Manifest Integration

When configuring `devhost.toml` for Vite, Storybook, or other modern frontend development environments, keep these networking, port, and security rules in mind.

---

## 1. Vite Security: "Allowed Hosts" (`server.allowedHosts`)

Since Vite v6, the dev server enforces host validation by default to protect against DNS rebinding attacks. When requests are proxied via custom `devhost` domains (e.g. `*.localhost` or `devhost.localhost`), Vite will block the connection.

### For Storybook (Vite-based)

Storybook's Vite builder provides an `allowedHosts` config option. To support routing custom domains:

1. In `devhost.toml`, pass the allowed domains as an environment variable to the Storybook service:
   ```toml
   [services.storybook.env]
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = "{{ env.DEVHOST_STORYBOOK }}"
   ```
2. Ensure `.storybook/main.ts` parses this environment variable and merges it into Storybook's `core.allowedHosts` and Vite's `server.allowedHosts` inside the `viteFinal` hook:
   ```typescript
   viteFinal(existingConfig) {
     if (storybookAllowedHosts.length === 0) return existingConfig;
     return mergeConfig(existingConfig, {
       server: { allowedHosts: storybookAllowedHosts },
     });
   }
   ```

### For Astro or other general Vite Apps

- Configure `server.allowedHosts: true` (or specify explicit hosts) in your local application dev config to allow the devhost routed proxy (as done in `packages/docs/astro.config.mjs` with `server.allowedHosts: true`).

---

## 2. Vite Loopback Bind-Host Mismatch (`bindHost`)

By default, `devhost` proxies to the IPv4 loopback (`127.0.0.1`). However, many modern machines resolve `localhost` and local listeners to the IPv6 loopback (`::1`).

If a Vite-style service binds exclusively to IPv6 (`::1`), `devhost`'s proxy will fail to connect to the target port, even though typing the port directly in your browser works.

- **Rule**: If a service binds to `::1`, set `bindHost = "::1"` explicitly on that service table in `devhost.toml`:
  ```toml
  [services.app]
  command = ["bun", "run", "dev"]
  port = 5173
  bindHost = "::1"
  ```
- _Note_: `devhost` will emit a startup warning if a listener mismatch is detected.

---

## 3. Dynamic Port Passing & Command Expansion ($PORT)

`devhost` injects the dynamically allocated port as a `PORT` environment variable for child processes. It does **not** perform string argument expansion for fields like `command`.

If a command needs the dynamic port passed as an argument (e.g., `--port $PORT`), passing the raw string `"$PORT"` directly in the string array will pass the literal string.

- **Rule**: Wrap the command in an explicit shell string to trigger standard shell variable expansion:
  ```toml
  command = ["sh", "-c", "exec ./node_modules/.bin/storybook dev --ci --port \"$PORT\""]
  ```
