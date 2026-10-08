import type { IDevhostStoryStack } from "../../../../.storybook/installDevhostStackMock";

export function factory_appStack(): IDevhostStoryStack {
  const now: number = Date.now();

  return {
    annotationQueues: [
      {
        activeSessionId: null,
        queueId: "q1",
        status: "paused",
        pauseReason: "session-exited-before-finished",
        entries: [
          {
            actionId: "agent",
            entryId: "e1",
            state: "paused-active",
            createdAt: now - 50000,
            updatedAt: now - 10000,
            annotation: {
              comment: "Change the primary button color to blue.",
              markers: [],
              stackName: "storybook-stack",
              submittedAt: now - 50000,
              title: "App.tsx",
              url: "http://app.localhost/",
            },
          },
          {
            actionId: "agent",
            entryId: "e2",
            state: "queued",
            createdAt: now - 40000,
            updatedAt: now - 40000,
            annotation: {
              comment: "Fix layout overlap on mobile screens",
              markers: [],
              stackName: "storybook-stack",
              submittedAt: now - 40000,
              title: "MobileLayout.tsx",
              url: "http://app.localhost/",
            },
          },
          {
            actionId: "agent",
            entryId: "e3",
            state: "queued",
            createdAt: now - 30000,
            updatedAt: now - 30000,
            annotation: {
              comment: "Add missing error handling",
              markers: [],
              stackName: "storybook-stack",
              submittedAt: now - 30000,
              title: "api.ts",
              url: "http://api.app.localhost/",
            },
          },
        ],
      },
    ],
    config: {
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [{ id: "agent", kind: "agent", label: "Pi", queueEnabled: true }],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      homeDirectoryPath: "/home/alex",
      position: "bottom-right",
      primaryService: "app",
      projectRootPath: "/storybook-workspace",
      stackName: "storybook-stack",
      annotationEnabled: true,
      annotationQueueEnabled: true,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      resourcesEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      routedServices: [
        { host: window.location.hostname, path: "/", serviceName: "app" },
        { host: window.location.hostname, path: "/api", serviceName: "api" },
        { host: "worker." + window.location.hostname, path: "/", serviceName: "worker" },
      ],
    },
    fallbackTerminalSnapshot: "MOCKED Agent Pi is ready.\r\n",
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
    terminalSessions: [
      {
        label: "Pi",
        sessionId: "pi-session",
        request: {
          actionId: "agent",
          kind: "agent",
          annotation: {
            comment: "Update the header title",
            markers: [],
            stackName: "storybook-stack",
            submittedAt: now,
            title: "Header.tsx",
            url: "http://app.localhost/",
          },
        },
      },
      {
        sessionId: "nvim-session",
        request: {
          kind: "editor",
          launcher: "neovim",
          componentName: "Header",
          source: {
            fileName: "/src/Header.tsx",
            lineNumber: 10,
            columnNumber: 5,
            componentName: "Header",
          },
          sourceLabel: "src/Header.tsx:10:5",
        },
      },
    ],
    terminalSnapshots: {
      "nvim-session": "\u001b[32m~ \u001b[34mMOCKED Neovim is running...\u001b[0m\r\n",
    },
  };
}

export function factory_designOverviewStack(): IDevhostStoryStack {
  const now: number = Date.now();

  return {
    annotationQueues: [
      {
        activeSessionId: null,
        queueId: "q1",
        status: "paused",
        pauseReason: "session-exited-before-finished",
        entries: [
          {
            actionId: "agent",
            entryId: "e1",
            state: "paused-active",
            createdAt: now - 50000,
            updatedAt: now - 10000,
            annotation: {
              comment: "Change primary button to modern border-radius and color",
              markers: [],
              stackName: "overview-stack",
              submittedAt: now - 50000,
              title: "WelcomeSection.tsx",
              url: "http://app.localhost/",
            },
          },
        ],
      },
    ],
    config: {
      nativeBrowserConfigured: false,
      nativeBrowserInstanceId: "",
      annotationActions: [
        { id: "agent", kind: "agent", label: "Pi", queueEnabled: true },
        { id: "cmd", kind: "command", label: "Audit", queueEnabled: false },
      ],
      annotationDefaultActionId: "agent",
      componentEditor: "vscode",
      homeDirectoryPath: "/home/alex",
      position: "bottom-right",
      projectRootPath: "/overview-workspace",
      stackName: "overview-stack",
      annotationEnabled: true,
      annotationQueueEnabled: true,
      editorEnabled: true,
      externalToolbarsEnabled: true,
      minimapEnabled: true,
      resourcesEnabled: true,
      statusEnabled: true,
      terminalEnabled: true,
      routedServices: [
        { host: window.location.hostname, path: "/", serviceName: "app" },
        { host: window.location.hostname, path: "/api", serviceName: "api" },
        { host: "worker." + window.location.hostname, path: "/", serviceName: "worker" },
      ],
    },
    fallbackTerminalSnapshot: null,
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
    terminalSessions: [
      {
        label: "Pi",
        sessionId: "pi-session",
        request: {
          actionId: "agent",
          kind: "agent",
          annotation: {
            comment: "Change primary button to modern border-radius and color",
            markers: [],
            stackName: "overview-stack",
            submittedAt: now,
            title: "WelcomeSection.tsx",
            url: "http://app.localhost/",
          },
        },
      },
      {
        sessionId: "nvim-session",
        request: {
          kind: "editor",
          launcher: "neovim",
          componentName: "WelcomeSection",
          source: {
            fileName: "/src/WelcomeSection.tsx",
            lineNumber: 15,
            columnNumber: 8,
            componentName: "WelcomeSection",
          },
          sourceLabel: "src/WelcomeSection.tsx:15:8",
        },
      },
    ],
    terminalSnapshots: {
      "pi-session":
        "\u001b[32m[agent:pi] \u001b[36mRunning workspace task:\u001b[0m Update the Get Started button to indigo theme\r\n\u001b[34m[agent:pi] Inspecting /src/WelcomeSection.tsx...\u001b[0m\r\n\u001b[33m[agent:pi] Applying inline JSX replacement at line 15\u001b[0m\r\n\u001b[1;32m✓ Replacement applied successfully!\u001b[0m\r\n\u001b[34m[agent:pi] Running build:devhost verification...\u001b[0m\r\n\u001b[1;32m✓ All package-local checks passed!\u001b[0m\r\n",
      "nvim-session":
        '\u001b[1;35mWelcomeSection.tsx\u001b[0m\r\n\u001b[34m 12 | \u001b[0m\u001b[32mexport function \u001b[1;36mWelcomeSection\u001b[0m() {\r\n\u001b[34m 13 | \u001b[0m  \u001b[32mreturn (\r\n\u001b[34m 14 | \u001b[0m    \u001b[33m<section \u001b[1;32mclassName\u001b[0m\u001b[35m=\u001b[0m\u001b[31m"bg-slate-950 p-6 rounded-lg"\u001b[33m>\u001b[0m\r\n\u001b[34m 15 | \u001b[0m      \u001b[33m<button \u001b[1;32mclassName\u001b[0m\u001b[35m=\u001b[0m\u001b[31m"px-4 py-1.5 bg-indigo-600 rounded text-white"\u001b[33m>\u001b[0m\r\n\u001b[34m 16 | \u001b[0m        Get Started\r\n\u001b[34m 17 | \u001b[0m      \u001b[33m</button>\u001b[0m\r\n',
    },
  };
}
