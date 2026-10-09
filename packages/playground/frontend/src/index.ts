import { serve } from "bun";
import { VIDEOS_PAGE } from "./constants";
import { createPrototypeRoutes } from "./createPrototypeRoutes";
import { createVideoRoutes } from "./createVideoRoutes";
import index from "./index.html";
import videos from "./videos.html";

const server = serve({
  routes: {
    // Design prototypes from `packages/design`, linked from the playground navigation.
    ...createPrototypeRoutes(new URL("../../../design/", import.meta.url)),

    // Demo recordings and guide demos of this checkout, played by the videos page.
    ...createVideoRoutes(new URL("../../../../", import.meta.url)),
    [VIDEOS_PAGE.path]: videos,

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
