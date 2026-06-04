import { serve } from "bun";

const routes = {
  "/api/hello": {
    async GET(req: Request) {
      return Response.json({
        message: "Hello, world!",
        method: "GET",
      });
    },
    async PUT(req: Request) {
      return Response.json({
        message: "Hello, world!",
        method: "PUT",
      });
    },
  },
};

const server = serve({
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    let response: Response;

    // Route matching
    if (path === "/api/hello") {
      const handler = routes["/api/hello"];
      const method = req.method as "GET" | "PUT";
      if (method in handler) {
        response = await handler[method](req);
      } else {
        response = new Response("Method Not Allowed", { status: 405 });
      }
    } else if (path.startsWith("/api/hello/")) {
      const name = path.slice("/api/hello/".length);
      response = Response.json({
        message: `Hello, ${decodeURIComponent(name)}!`,
      });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    // Add CORS headers to all responses
    response.headers.set("Access-Control-Allow-Origin", "*");
    response.headers.set("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    return response;
  },
});

console.log(`🚀 Backend server running at ${server.url}`);
