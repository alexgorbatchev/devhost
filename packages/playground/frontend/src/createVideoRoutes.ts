import { DEMO_VIDEOS_INDEX_PATH, DEMO_VIDEOS_PATH } from "./constants";
import { readDemoMedia } from "./readDemoMedia";

export type VideoRoutes = Record<string, (request: Request) => Promise<Response>>;

export function createVideoRoutes(repositoryDirectory: URL): VideoRoutes {
  return {
    [`${DEMO_VIDEOS_PATH}*`]: async (request) => {
      const media = await readDemoMedia(repositoryDirectory);
      const { pathname } = new URL(request.url);
      if (pathname === DEMO_VIDEOS_INDEX_PATH) return Response.json(media.videos);
      // Only a listed file is served: a run directory also holds logs, sessions and configuration.
      const file = media.files.get(pathname);
      if (file === undefined) return new Response("Not Found", { status: 404 });
      // Bun answers a player's Range requests for a file response itself.
      return new Response(Bun.file(file));
    },
  };
}
