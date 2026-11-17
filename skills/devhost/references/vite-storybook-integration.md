# Vite and Storybook Manifest Integration

When configuring `devhost.toml` for Vite, Storybook, or other modern frontend development environments, keep these networking, port, and security rules in mind.

---

## 1. Vite Security: "Allowed Hosts" (`server.allowedHosts`)

Vite allows `localhost`, `.localhost` subdomains, and IP addresses by default. Add the resolved public hostname when using a custom local suffix or remote preview domain. See [Vite’s host validation settings](https://vite.dev/config/server-options#server-allowedhosts).

### For Storybook (Vite-based)

Storybook validates requests through [`core.allowedHosts`](https://storybook.js.org/docs/api/main-config/main-config-core#allowedhosts); its Vite builder also uses Vite's `server.allowedHosts`. To support routing custom domains:

1. In `devhost.toml`, pass the allowed domains as an environment variable to the Storybook service:
   ```toml
   [services.storybook.env]
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = "{{ services.storybook.host }}"
   ```
2. Parse the environment variable into `storybookAllowedHosts` in `.storybook/main.ts`, splitting comma-separated values and trimming empty entries. Set `core.allowedHosts` on the Storybook configuration and merge the same list into Vite's `server.allowedHosts` in `viteFinal`. With `mergeConfig` imported from `vite`, these configuration properties are:
   ```typescript
   core: { allowedHosts: storybookAllowedHosts },
   viteFinal(existingConfig) {
     if (storybookAllowedHosts.length === 0) return existingConfig;
     return mergeConfig(existingConfig, {
       server: { allowedHosts: storybookAllowedHosts },
     });
   }
   ```

### For Astro or other general Vite Apps

- Configure an explicit `server.allowedHosts` list containing the resolved devhost hostname, or use Vite’s `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` environment variable as above. Allowing every hostname with `true` exposes the server to DNS rebinding.

---

## 2. Vite Loopback Bind-Host Mismatch (`bindHost`)

By default, `devhost` proxies to the IPv4 loopback (`127.0.0.1`). However, many modern machines resolve `localhost` and local listeners to the IPv6 loopback (`::1`).

If a Vite-style service binds exclusively to IPv6 (`::1`), `devhost`'s default IPv4 health check and proxy will fail to connect to the target port, even though typing the port directly in your browser works.

`bindHost` selects devhost's target address; the application owns its listener. Configure Vite's `server.host` and `server.port` to match the manifest's address and assigned port, with `server.strictPort = true` to keep the port fixed. Verify the actual listener before changing the manifest. See [Vite's server options](https://vite.dev/config/server-options).

- **Rule**: If a service binds to `::1`, set `bindHost = "::1"` explicitly on that service table in `devhost.toml`:
  ```toml
  [services.app]
  command = ["bun", "run", "dev"]
  port = 5173
  bindHost = "::1"
  ```
- _Note_: `devhost` will emit a startup warning if a listener mismatch is detected.

A health-check mismatch ends at the configured timeout and leaves recovery retryable. Its recovery page shows the failure while the repository's other services keep running. A failed worktree switch whose restore also fails stops the repository instead and shows the error on every member's recovery page. Correct the listener configuration, then retry **Restart**. Removing `bindHost` selects IPv4 loopback, so verify the app accepts IPv4 before using the default.

---

## 3. Dynamic Port Passing & Command Expansion ($PORT)

`devhost` injects the dynamically allocated port as a `PORT` environment variable for child processes. It does **not** perform string argument expansion for fields like `command`.

If a command needs the dynamic port passed as an argument (e.g., `--port $PORT`), passing the raw string `"$PORT"` directly in the string array will pass the literal string.

- **Rule**: Wrap the command in an explicit shell string to trigger standard shell variable expansion:
  ```toml
  command = ["sh", "-c", "exec ./node_modules/.bin/storybook dev --ci --port \"$PORT\""]
  ```
