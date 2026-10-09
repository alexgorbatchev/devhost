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
        Renders of <code>just demo record</code> and <code>just demo promo</code> from this checkout, and the guide
        demos the docs site publishes. Reload the page after a new render.
      </p>
      <nav className="playground-navigation" aria-label="Playground">
        <a href="/">Back to the playground</a>
      </nav>
      {query.isPending && <p role="status">Loading videos…</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {query.isSuccess && (
        <>
          <VideoSection
            heading="Recordings"
            layout="single"
            emptyMessage="No run under .tmp/demos has a rendered video yet. Run just demo record in this checkout."
            videos={query.data.filter((video) => video.kind === "recording")}
          />
          <VideoSection
            heading="Guide demos"
            layout="grid"
            emptyMessage="packages/docs/public/demos holds no guide video."
            videos={query.data.filter((video) => video.kind === "guide")}
          />
        </>
      )}
    </main>
  );
}
