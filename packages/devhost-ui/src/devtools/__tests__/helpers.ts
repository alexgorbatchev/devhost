import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildDevtoolsBundle } from "../../../../../apps/devhost/scripts/buildDevtoolsBundle";
import type { IStartEditorTerminalSessionRequest } from "../features/terminalSessions/types";
import { createOwnedBrowserEnvironment } from "../../../../../test-support/createOwnedBrowserEnvironment";

interface IBuiltDevtoolsHost {
  /** The environment for the browser a test opens this host in. Its home lives in the host's own directory. */
  browserEnvironment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
  requests: string[];
  requestUrls: string[];
  requestHeaders: Headers[];
  delayTerminalRuntime: () => void;
  releaseTerminalRuntime: () => void;
  failTerminalRuntime: () => void;
  restoreTerminal: () => void;
  setStackName: (name: string) => void;
  url: string;
}

export async function startBuiltDevtoolsHost(): Promise<IBuiltDevtoolsHost> {
  const temporaryRootPath: string = resolve(import.meta.dir, "../../../../..", ".tmp");
  await mkdir(temporaryRootPath, { recursive: true });
  const directoryPath: string = await mkdtemp(resolve(temporaryRootPath, "browser-bundle-"));
  try {
    await buildDevtoolsBundle({ outputDirectoryPath: directoryPath });
  } catch (error) {
    await rm(directoryPath, { recursive: true, force: true });
    throw error;
  }
  const browserEnvironment: NodeJS.ProcessEnv = await createOwnedBrowserEnvironment(directoryPath);
  const requests: string[] = [];
  const requestUrls: string[] = [];
  const requestHeaders: Headers[] = [];
  let stackName: string = "bundle-browser-test";
  let shouldRestoreTerminal: boolean = false;
  let shouldDelayTerminalRuntime: boolean = false;
  let shouldFailTerminalRuntime: boolean = false;
  const runtimeGate = Promise.withResolvers<void>();
  const terminalRequest: IStartEditorTerminalSessionRequest = {
    componentName: "Widget",
    kind: "editor",
    launcher: "neovim",
    source: { fileName: "src/Widget.tsx", lineNumber: 1 },
    sourceLabel: "src/Widget.tsx:1",
  };
  const server = Bun.serve<string>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server): Promise<Response | undefined> {
      const url: URL = new URL(request.url);
      requests.push(url.pathname);
      requestUrls.push(url.pathname + url.search);
      requestHeaders.push(request.headers);
      if (url.pathname.startsWith("/__devhost__/assets/xterm-")) {
        if (shouldDelayTerminalRuntime) await runtimeGate.promise;
        if (shouldFailTerminalRuntime) return new Response(null, { status: 503 });
      }
      if (url.pathname.startsWith("/__devhost__/ws/")) {
        return server.upgrade(request, { data: url.pathname }) ? undefined : new Response(null, { status: 400 });
      }
      if (url.pathname === "/__devhost__/config.json") {
        return Response.json(
          {
            stackName,
            terminalEnabled: true,
            annotationEnabled: false,
            annotationQueueEnabled: false,
            editorEnabled: false,
            externalToolbarsEnabled: false,
            minimapEnabled: false,
            statusEnabled: false,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (url.pathname === "/__devhost__/terminal-sessions") {
        return Response.json({
          sessions: shouldRestoreTerminal ? [{ request: terminalRequest, sessionId: "restored-session" }] : [],
        });
      }
      if (
        url.pathname === "/__devhost__/inject.js" ||
        url.pathname === "/__devhost__/xterm.css" ||
        /^\/__devhost__\/assets\/[^/]+\.(js|woff2)$/.test(url.pathname)
      ) {
        const name: string =
          url.pathname === "/__devhost__/inject.js" ? "devtools.js" : url.pathname.slice("/__devhost__/".length);
        return new Response(Bun.file(resolve(directoryPath, name)), {
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }
      return new Response(
        '<!doctype html><html><body><main>Host application</main><script type="module" src="/__devhost__/inject.js"></script></body></html>',
        {
          headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
        },
      );
    },
    websocket: {
      open(socket): void {
        socket.send(
          JSON.stringify(
            socket.data.endsWith("/terminal")
              ? { type: "snapshot", data: "lazy terminal ready\r\n" }
              : { services: [] },
          ),
        );
      },
      message(): void {},
    },
  });
  return {
    requests,
    requestUrls,
    requestHeaders,
    url: server.url.toString(),
    setStackName: (name): void => {
      stackName = name;
    },
    restoreTerminal: (): void => {
      shouldRestoreTerminal = true;
    },
    delayTerminalRuntime: (): void => {
      shouldDelayTerminalRuntime = true;
    },
    releaseTerminalRuntime: (): void => {
      runtimeGate.resolve();
    },
    failTerminalRuntime: (): void => {
      shouldFailTerminalRuntime = true;
    },
    browserEnvironment,
    close: async (): Promise<void> => {
      runtimeGate.resolve();
      await server.stop(true);
      await rm(directoryPath, { recursive: true, force: true });
    },
  };
}
