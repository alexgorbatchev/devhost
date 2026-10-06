import { resolve } from "node:path";
import type { Server } from "bun";

export function serveNativeReactFixture(bundlePath: string): Server<undefined> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const url = new URL(request.url);
      const prefix: string = "/native-react-fixture/";
      if (url.pathname.startsWith(prefix)) {
        const relativePath = url.pathname.slice(prefix.length);
        if (relativePath.includes("..")) return new Response(null, { status: 404 });
        return new Response(Bun.file(resolve(bundlePath, relativePath)));
      }
      if (url.pathname === "/unrelated")
        return new Response("<!doctype html><html><body>Unrelated native page</body></html>", {
          headers: { "Content-Type": "text/html" },
        });
      const ownedAppContainer: string =
        url.searchParams.get("owner") === "fixture"
          ? '<div id="devhost-devtools-host" data-devhost-devtools></div><div id="fixture-controls" data-devhost-devtools></div>'
          : "";
      return new Response(
        `<!doctype html><html><head><title>Genuine native React acceptance host</title></head><body><div id="host-root"></div>${ownedAppContainer}<script type="module" src="/native-react-fixture/host.js"></script></body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    },
  });
}
