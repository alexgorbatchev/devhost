import { E2E_TEMPORARY_PATH } from "../../../../../test-support/constants";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildDevtoolsBundle } from "../../../../../apps/devhost/scripts/buildDevtoolsBundle";
import { createOwnedBrowserEnvironment } from "../../../../../test-support/createOwnedBrowserEnvironment";

interface IBuiltDevtoolsHost {
  /** The environment for the browser a test opens this host in. Its home lives in the host's own directory. */
  browserEnvironment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
  requests: string[];
  requestUrls: string[];
  requestHeaders: Headers[];
  setStackName: (name: string) => void;
  url: string;
}

export async function startBuiltDevtoolsHost(): Promise<IBuiltDevtoolsHost> {
  const temporaryRootPath: string = E2E_TEMPORARY_PATH;
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
  const server = Bun.serve<string>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server): Promise<Response | undefined> {
      const url: URL = new URL(request.url);
      requests.push(url.pathname);
      requestUrls.push(url.pathname + url.search);
      requestHeaders.push(request.headers);
      if (url.pathname.startsWith("/__devhost__/ws/")) {
        return server.upgrade(request, { data: url.pathname }) ? undefined : new Response(null, { status: 400 });
      }
      if (url.pathname === "/__devhost__/config.json") {
        return Response.json(
          {
            stackName,
            chatEnabled: false,
            annotationEnabled: false,
            editorEnabled: false,
            externalToolbarsEnabled: false,
            minimapEnabled: false,
            statusEnabled: true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (
        url.pathname === "/__devhost__/inject.js" ||
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
        socket.send(JSON.stringify({ services: [] }));
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
    browserEnvironment,
    close: async (): Promise<void> => {
      await server.stop(true);
      await rm(directoryPath, { recursive: true, force: true });
    },
  };
}
