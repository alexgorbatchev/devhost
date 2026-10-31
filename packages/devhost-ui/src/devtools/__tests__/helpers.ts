import { E2E_TEMPORARY_PATH } from "../../../../../test-support/constants";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { buildDevtoolsBundle } from "../../../../../apps/devhost/scripts/buildDevtoolsBundle";
import { createOwnedBrowserEnvironment } from "../../../../../test-support/createOwnedBrowserEnvironment";
import type { Page } from "playwright";
import { z } from "zod";
import type { IChatSnapshot } from "../features/agentChat/types";

interface IBuiltDevtoolsHost {
  /** The environment for the browser a test opens this host in. Its home lives in the host's own directory. */
  browserEnvironment: NodeJS.ProcessEnv;
  close: () => Promise<void>;
  requests: string[];
  requestUrls: string[];
  requestHeaders: Headers[];
  requestMethods: string[];
  chatCommands: string[];
  setStackName: (name: string) => void;
  url: string;
}

export async function startBuiltDevtoolsHost(chat?: IChatSnapshot): Promise<IBuiltDevtoolsHost> {
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
  const requestMethods: string[] = [];
  const chatCommands: string[] = [];
  let isChatClosed = false;
  let stackName: string = "bundle-browser-test";
  const server = Bun.serve<string>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server): Promise<Response | undefined> {
      const url: URL = new URL(request.url);
      requests.push(url.pathname);
      requestUrls.push(url.pathname + url.search);
      requestHeaders.push(request.headers);
      requestMethods.push(request.method);
      if (url.pathname.startsWith("/__devhost__/ws/")) {
        return server.upgrade(request, { data: url.pathname }) ? undefined : new Response(null, { status: 400 });
      }
      if (url.pathname === "/__devhost__/config.json") {
        return Response.json(
          {
            stackName,
            chatEnabled: chat !== undefined,
            projectRootPath: chat?.session.projectRootPath,
            annotationEnabled: false,
            editorEnabled: false,
            externalToolbarsEnabled: false,
            minimapEnabled: false,
            statusEnabled: true,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (url.pathname === "/__devhost__/agents") return Response.json({ agents: [] });
      if (url.pathname === "/__devhost__/chat/panel") return Response.json({ position: null });
      if (url.pathname === "/__devhost__/chat/harnesses")
        return Response.json({
          harnesses: [
            {
              id: "codex",
              label: "Codex",
              available: true,
              models: [{ id: "native-model", label: "Native model", description: "Installed model" }],
            },
          ],
        });
      if (url.pathname === "/__devhost__/chat/sessions")
        return Response.json({
          sessions: chat ? [isChatClosed ? { ...chat.session, status: "closed" } : chat.session] : [],
        });
      if (chat && url.pathname === `/__devhost__/chat/sessions/${chat.session.id}/close` && request.method === "POST") {
        isChatClosed = true;
        return Response.json({ ...chat.session, status: "closed" });
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
        socket.send(JSON.stringify(socket.data === "/__devhost__/ws/chat" && chat ? chat : { services: [] }));
      },
      message(socket, message): void {
        if (socket.data !== "/__devhost__/ws/chat" || !chat) return;
        chatCommands.push(String(message));
        const command = z
          .object({ type: z.literal("send"), commandId: z.string() })
          .safeParse(JSON.parse(String(message)));
        if (!command.success) return;
        socket.send(
          JSON.stringify({ type: "command_result", sessionId: chat.session.id, commandId: command.data.commandId }),
        );
        socket.send(
          JSON.stringify({
            type: "event",
            sessionId: chat.session.id,
            sequence: (chat.events?.length ?? 0) + 1,
            payload: {
              method: "item/completed",
              params: {
                item: { type: "agentMessage", id: "continued-reply", text: `Continued in ${chat.session.id}` },
              },
            },
          }),
        );
      },
    },
  });
  return {
    requests,
    requestUrls,
    requestHeaders,
    requestMethods,
    chatCommands,
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

export async function waitForChatScroll(page: Page, top: number): Promise<void> {
  await page.waitForFunction((expected) => {
    const root = document.querySelector("#devhost-devtools-host")?.shadowRoot;
    return root?.querySelector('[data-slot="aui_thread-viewport"]')?.scrollTop === expected;
  }, top);
}

/** Opens the Chat Settings select named `setting` and clicks its `option`, as a user does. */
export async function chooseChatSetting(page: Page, setting: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: setting }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "detached" });
}
