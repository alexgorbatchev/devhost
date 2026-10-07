import type { IGuideTerminalScene, IGuideTerminalStep } from "./types";

const header =
  'name = "Guide demo"\nkillZombies = false\n\n[worktrees]\nenabled = false\n\n[caddy.global]\nadminAddress = "{{ env.DEVHOST_DEMO_ADMIN }}"\n';
const web =
  '\n[services.web]\nprimary = true\ncommand = ["bun", "serveGuideService.ts"]\nport = "auto"\nhost = "{{ env.DEVHOST_DEMO_HOST }}"\n';
const api =
  '\n[services.api]\ncommand = ["bun", "serveGuideService.ts"]\nport = "auto"\nhost = "{{ env.DEVHOST_DEMO_HOST }}"\npath = "/api/*"\n';
const start: IGuideTerminalStep = {
  command: "devhost start > stack.log 2>&1 &",
  waitPattern: "^>$",
  shouldWaitForStack: true,
};
const logs: IGuideTerminalStep = { command: "cat stack.log", waitPattern: "web \\(primary\\): https:", holdMs: 3_000 };
const stop: IGuideTerminalStep = { command: "devhost stop", waitPattern: "stopped cleanly", holdMs: 2_000 };
const curl: IGuideTerminalStep = {
  command: "curl -fsS https://demo.localhost/ | tee response.json",
  waitPattern: '"service":"web"',
  holdMs: 4_000,
};
const config: IGuideTerminalStep = { command: "cat devhost.toml", waitPattern: 'name = "Guide demo"', holdMs: 4_000 };

export function createGuideTerminalScene(slug: string, port: number): IGuideTerminalScene {
  const steps = [config, start, logs, curl, stop];
  switch (slug) {
    case "managed-caddy":
      return {
        slug,
        caption: "One proxy. Local HTTPS domains. Route each service by path.",
        manifest: header + web + api,
        steps: [
          config,
          start,
          logs,
          curl,
          {
            command: "curl -fsS https://demo.localhost/api/ | tee api-response.json",
            waitPattern: '"service":"api"',
            holdMs: 3_000,
          },
          stop,
        ],
      };
    case "stack-lifecycle":
      return {
        slug,
        caption: "Start dependencies first. Stop the whole stack with one command.",
        manifest: header + api + web + 'dependsOn = ["api"]\n',
        steps,
      };
    case "environment-variables":
      return {
        slug,
        caption: "Automatic bind inputs and service context reach your application.",
        manifest:
          header + web + '\n[services.web.env]\nSHOW_BIND_INPUTS = "1"\nDEMO_MESSAGE = "Configured in devhost.toml"\n',
        steps,
      };
    case "service-references":
      return {
        slug,
        caption: "Resolve the API's assigned port before starting its consumer.",
        manifest:
          header +
          api.replace('port = "auto"', 'bindHost = "127.0.0.1"\nport = "auto"') +
          web +
          'dependsOn = ["api"]\n\n[services.web.env]\nAPI_URL = "http://{{ services.api.bindHost }}:{{ services.api.port }}"\n',
        steps,
      };
    case "manifest-includes":
      return {
        slug,
        caption: "Each package owns its services. The root starts them together.",
        manifest: header.replace(
          "killZombies = false\n",
          'killZombies = false\nincludes = ["packages/*/devhost.toml"]\n',
        ),
        files: { "packages/web/devhost.toml": web.trimStart(), "packages/api/devhost.toml": api.trimStart() },
        steps: [
          config,
          { command: "cat packages/*/devhost.toml", waitPattern: "\\[services.api\\]", holdMs: 4_000 },
          start,
          logs,
          curl,
          stop,
        ],
      };
    case "managed-daemon-style-services":
      return {
        slug,
        caption: "Own a background service through explicit start, status, and stop commands.",
        daemonPort: port,
        manifest:
          header +
          `\n[services.web]\nprimary = true\nport = ${port}\nhost = "{{ env.DEVHOST_DEMO_HOST }}"\nhealth = { http = "http://127.0.0.1:${port}/" }\n\n[services.web.lifecycle]\nmode = "daemon"\nstart = ["bun", "startGuideDaemon.ts"]\nstatus = ["bun", "probeGuideDaemon.ts"]\nstop = ["bun", "stopGuideDaemon.ts"]\n`,
        steps: [
          config,
          start,
          logs,
          curl,
          stop,
          {
            command: "test ! -e /proc/$(cat daemon.pid)/exe && echo 'Daemon stopped'",
            waitPattern: "(?m)^Daemon stopped",
            holdMs: 3_000,
          },
        ],
      };
    case "docker-backed-services":
      return {
        slug,
        caption: "Route a published Docker port. Its lifecycle stays with Docker.",
        isDocker: true,
        dockerPort: port,
        manifest:
          header +
          `\n[services.web]\nprimary = true\nmanaged = false\nport = ${port}\nhost = "{{ env.DEVHOST_DEMO_HOST }}"\nhealth = { http = "http://127.0.0.1:${port}/" }\n`,
        steps: [
          config,
          { command: 'docker start "$DEVHOST_DEMO_CONTAINER"', waitPattern: "(?m)^devhost-guide-", holdMs: 2_000 },
          { command: 'docker port "$DEVHOST_DEMO_CONTAINER"', waitPattern: "127.0.0.1:", holdMs: 2_000 },
          start,
          logs,
          {
            command: "curl -fsS https://demo.localhost/ | tee response.json",
            waitPattern: "(?m)^Docker backend",
            holdMs: 4_000,
          },
          stop,
          {
            command: 'docker inspect -f "{{.State.Running}}" "$DEVHOST_DEMO_CONTAINER"',
            waitPattern: "(?m)^true",
            holdMs: 2_000,
          },
          { command: 'docker rm -f "$DEVHOST_DEMO_CONTAINER"', waitPattern: "(?m)^devhost-guide-", holdMs: 2_000 },
        ],
      };
    case "troubleshooting":
      return {
        slug,
        caption: "A rejected manifest leaves the running stack intact. Correct it and save again.",
        manifest: header + web,
        files: {
          "invalid.toml": header + web.replace('port = "auto"', "port = -1"),
          "fixed.toml": header + web + '\n[services.web.env]\nDEMO_MESSAGE = "Configuration fixed"\n',
        },
        steps: [
          config,
          start,
          logs,
          { command: "cp invalid.toml devhost.toml", waitPattern: "^>$", holdMs: 1_000 },
          { command: "sleep 1; cat stack.log", waitPattern: "configuration reload rejected", holdMs: 4_000 },
          curl,
          { command: "cp fixed.toml devhost.toml", waitPattern: "^>$", holdMs: 1_000 },
          { command: "sleep 1; cat stack.log", waitPattern: "configuration reloaded", holdMs: 3_000 },
          {
            command: "curl -fsS https://demo.localhost/ | tee fixed-response.json",
            waitPattern: "Configuration fixed",
            holdMs: 3_000,
          },
          stop,
        ],
      };
    case "shared-managed-caddy-settings":
      return {
        slug,
        caption: "Shared listener settings serve the same routed service over HTTP and HTTPS.",
        isPrivateCaddy: true,
        manifest:
          header.replace(
            'adminAddress = "{{ env.DEVHOST_DEMO_ADMIN }}"\n',
            'adminAddress = "{{ env.DEVHOST_DEMO_ADMIN }}"\nhttp = true\nhttpPort = {{ env.DEVHOST_DEMO_HTTP_PORT }}\nhttpsPort = {{ env.DEVHOST_DEMO_HTTPS_PORT }}\n',
          ) + web,
        steps: [
          config,
          start,
          logs,
          {
            command: 'curl -fsS "$DEVHOST_DEMO_URL" | tee response.json',
            waitPattern: '"service":"web"',
            holdMs: 3_000,
          },
          {
            command: 'curl -fsS "http://demo.localhost:$DEVHOST_DEMO_HTTP_PORT/" | tee http-response.json',
            waitPattern: '"service":"web"',
            holdMs: 3_000,
          },
          stop,
        ],
      };
    default:
      throw new Error(`No terminal demo for guide: ${slug}`);
  }
}
