import { serve } from "bun";
import { createPrototypeRoutes } from "./createPrototypeRoutes";
import index from "./index.html";

const server = serve({
  routes: {
    // Design prototypes from `packages/design`, linked from the playground navigation.
    ...createPrototypeRoutes(new URL("../../../design/", import.meta.url)),


    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Frontend server running at ${server.url}`);
