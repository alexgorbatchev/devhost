import { useQuery } from "@tanstack/react-query";
import type { JSX } from "react";
import { fetchDemoVideos } from "../fetchDemoVideos";
import { VideoSection } from "./VideoSection";

export function VideoGallery(): JSX.Element {
  const query = useQuery({
    queryKey: ["playground", "videos"],
    queryFn: ({ signal }) => fetchDemoVideos(fetch, signal),
  });

  return (
    <main className="app video-gallery">
      <h1>Demo videos</h1>
      <p>
        Every current demo, once: the latest render of the promo and each guide. A guide is marked as published when the
        file on disk is the one in the GitHub media release. Reload the page after a new render.
      </p>
      <nav className="playground-navigation" aria-label="Playground">
        <a href="/">Back to the playground</a>
      </nav>
      {query.isPending && <p role="status">Loading videos…</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && (
        <>
          <VideoSection
            heading="Promo"
            layout="single"
            emptyMessage="This checkout has no promo render yet. Run just demo record."
            videos={query.data.filter((video) => video.kind === "promo")}
          />
          <VideoSection
            heading="Guides"
            layout="grid"
            emptyMessage="No guide video is on disk or pinned in packages/docs/demo-media.json."
            videos={query.data.filter((video) => video.kind === "guide")}
          />
        </>
      )}
    </main>
  );
}
