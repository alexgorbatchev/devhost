import type { IDevhostStoryStack } from "../../../../.storybook/installDevhostStackMock";

export function factory_appStack(): IDevhostStoryStack {
  return {
    config: {
      componentEditor: "vscode",
      homeDirectoryPath: "/home/alex",
      devhostSourceRootPath: "",
      controlOrigin: "",
      position: "bottom-right",
      primaryService: "app",
      projectRootPath: "/storybook-workspace",
      stackName: "storybook-stack",
      annotationEnabled: true,
      configEditorEnabled: false,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      resourcesEnabled: true,
      statusEnabled: true,
      chatEnabled: true,
      routedServices: [
        { host: window.location.hostname, path: "/", serviceName: "app" },
        { host: window.location.hostname, path: "/api", serviceName: "api" },
        { host: "worker." + window.location.hostname, path: "/", serviceName: "worker" },
      ],
    },
    logEntries: [
      { id: 1, line: "Listening on http://app.localhost", serviceName: "app", stream: "stdout" },
      { id: 2, line: "Starting API server...", serviceName: "api", stream: "stdout" },
      { id: 3, line: "API listening on port 4000", serviceName: "api", stream: "stdout" },
      { id: 4, line: "Worker failed to start", serviceName: "worker", stream: "stderr" },
    ],
    resourceUsage: {
      cpu: { cores: 8, percent: 18 },
      disk: { percent: 41, totalBytes: 512_000_000_000, usedBytes: 212_000_000_000 },
      memory: { percent: 31, totalBytes: 32_000_000_000, usedBytes: 9_800_000_000 },
    },
    services: [
      { managed: true, name: "app", status: true },
      { managed: true, name: "api", status: true },
      { managed: false, name: "worker", status: false },
    ],
  };
}

/** The app stack with the config editor on, after devhost rejected the last reload of the manifest. */
export function factory_configEditorStack(): IDevhostStoryStack {
  const stack: IDevhostStoryStack = factory_appStack();

  return {
    ...stack,
    config: { ...stack.config, configEditorEnabled: true },
    configFiles: [
      {
        content: 'name = "storybook-stack"\n',
        kind: "manifest",
        path: "/storybook-workspace/devhost.toml",
        version: "manifest-1",
      },
    ],
    configuration: [
      {
        error: "Failed to parse /storybook-workspace/devhost.toml: toml: line 2: expected value",
        reloads: 2,
        source: "manifest",
      },
    ],
  };
}

export function factory_designOverviewStack(): IDevhostStoryStack {
  return {
    config: {
      componentEditor: "vscode",
      homeDirectoryPath: "/home/alex",
      devhostSourceRootPath: "",
      controlOrigin: "",
      position: "bottom-right",
      projectRootPath: "/overview-workspace",
      stackName: "overview-stack",
      annotationEnabled: true,
      configEditorEnabled: false,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      resourcesEnabled: true,
      statusEnabled: true,
      chatEnabled: true,
      routedServices: [
        { host: window.location.hostname, path: "/", serviceName: "app" },
        { host: window.location.hostname, path: "/api", serviceName: "api" },
        { host: "worker." + window.location.hostname, path: "/", serviceName: "worker" },
      ],
    },
    logEntries: [
      { id: 1, line: "DB connection pool initialized (10 connections)", serviceName: "db", stream: "stdout" },
      { id: 2, line: "Cache warm-up completed: 1,240 keys loaded", serviceName: "cache", stream: "stdout" },
      { id: 3, line: "Registering message handlers...", serviceName: "worker", stream: "stdout" },
      { id: 4, line: "Broker connected successfully to RabbitMQ", serviceName: "worker", stream: "stdout" },
      { id: 5, line: "API router registered 18 endpoints", serviceName: "api", stream: "stdout" },
      { id: 6, line: "GET /healthz 200 OK - 2.5ms", serviceName: "api", stream: "stdout" },
      { id: 7, line: "GET /v1/user/profile 200 OK - 12.8ms", serviceName: "api", stream: "stdout" },
      { id: 8, line: "[WARN] Deprecated endpoint /v1/legacy-auth accessed", serviceName: "api", stream: "stdout" },
      { id: 9, line: "POST /v1/billing/checkout 500 Internal Server Error", serviceName: "api", stream: "stderr" },
      { id: 10, line: "[ERROR] Stripe checkout token invalid or expired", serviceName: "api", stream: "stderr" },
      { id: 11, line: "Job scheduler initialized (3 active cron triggers)", serviceName: "cron", stream: "stdout" },
      { id: 12, line: "Running scheduled job: clean_stale_sessions", serviceName: "cron", stream: "stdout" },
      { id: 13, line: "Database backup started...", serviceName: "db", stream: "stdout" },
      { id: 14, line: "Database backup completed (size: 42MB)", serviceName: "db", stream: "stdout" },
      { id: 15, line: "Listening on http://app.localhost", serviceName: "app", stream: "stdout" },
    ],
    resourceUsage: {
      cpu: { cores: 8, percent: 78 },
      disk: { percent: 97, totalBytes: 512_000_000_000, usedBytes: 498_000_000_000 },
      memory: { percent: 31, totalBytes: 32_000_000_000, usedBytes: 9_800_000_000 },
    },
    services: [
      { managed: true, name: "app", status: true },
      { managed: true, name: "api", status: true },
      { managed: true, name: "worker", status: true },
      { managed: true, name: "db", status: true },
      { managed: true, name: "cache", status: true },
      { managed: true, name: "cron", status: true },
    ],
  };
}
