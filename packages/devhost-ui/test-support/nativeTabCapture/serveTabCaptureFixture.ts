import { resolve } from "node:path";
import { z } from "zod";
import type { ITabCaptureFixtureServer } from "./types";

const session = {
  id: "native-capture-session",
  harness: "codex",
  projectRootPath: "/native-capture-fixture",
  status: "idle",
};
export function serveTabCaptureFixture(bundlePath: string, title: string): ITabCaptureFixtureServer {
  const commands: unknown[] = [];
  const sent = Promise.withResolvers<unknown>();
  const server = Bun.serve<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request, server): Promise<Response | undefined> {
      const url = new URL(request.url);
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
      if (url.pathname === "/__devhost__/chat/harnesses")
        return Response.json({ harnesses: [{ id: "codex", label: "Codex", available: true, models: [] }] });
      if (url.pathname === "/__devhost__/chat/sessions")
        return Response.json(request.method === "POST" ? session : { sessions: [] });
      if (url.pathname === "/__devhost__/ws/chat")
        return server.upgrade(request) ? undefined : new Response(null, { status: 400 });
      if (url.pathname.startsWith("/native-tab-capture/")) {
        const relative = url.pathname.slice("/native-tab-capture/".length);
        if (relative.includes("..")) return new Response(null, { status: 404 });
        const file = Bun.file(resolve(bundlePath, relative));
        return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
      }
      if (url.pathname !== "/") return new Response(null, { status: 404 });
      return new Response(
        `<!doctype html><html><head><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;background:rgb(20,50,75)}#host-target{position:absolute;left:40px;top:60px;width:220px;height:120px;background:rgb(55,160,90);color:white;border:0}#devhost-devtools-host{all:initial}dialog,[popover]{position:fixed;inset:auto;left:40px;top:200px;width:600px;height:400px;margin:0;border:0;padding:0;background:rgb(200,90,130)}dialog::backdrop{background:transparent}</style></head><body><button id="host-target">Actual host page</button><button type="button" onclick="document.getElementById('capture-modal').showModal()">Open capture modal</button><button type="button" popovertarget="capture-popover">Open capture popover</button><dialog id="capture-modal" aria-label="Capture modal"><button type="button">Modal target</button></dialog><section id="capture-popover" popover="auto" aria-label="Capture popover"><button type="button">Popover target</button></section><div id="devhost-devtools-host" data-devhost-devtools data-theme="dark"></div><script type="module" src="/native-tab-capture/capture.js"></script></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
    websocket: {
      open(socket): void {
        socket.send(
          JSON.stringify({ type: "snapshot", sessionId: session.id, session, events: [], pendingRequestIds: [] }),
        );
      },
      message(socket, payload): void {
        const value: unknown = JSON.parse(typeof payload === "string" ? payload : payload.toString());
        const command = z.object({ type: z.literal("send"), commandId: z.string().min(1) }).parse(value);
        commands.push(value);
        socket.send(JSON.stringify({ type: "command_result", sessionId: session.id, commandId: command.commandId }));
        sent.resolve(value);
      },
    },
  });
  return { server, readCommands: () => commands, sentCommand: sent.promise };
}
