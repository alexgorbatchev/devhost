import type { Server } from "bun";
import type { IStartingStackState } from "../helpers";

// Answers the way devhost does while a stack starts: a browser navigation gets devhost's own startup page until the
// service passes its health check, and every other request already reaches the app.
export function serveStartingStack(state: IStartingStackState): Server<undefined> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request): Response => {
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return new Response("api", { status: state.isApiUp ? 200 : 502 });
      }
      if (request.headers.get("Sec-Fetch-Dest") === "document" && !state.isPageHealthy) {
        return new Response("Starting web", { status: 503 });
      }
      return new Response("page");
    },
  });
}
