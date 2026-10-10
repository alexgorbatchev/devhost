import { useId, type JSX } from "react";
import type { IDemoVideo } from "../types";

interface IVideoSectionProps {
  heading: string;
  // `single` gives each video the full width; `grid` places several side by side.
  layout: "single" | "grid";
  emptyMessage: string;
  videos: IDemoVideo[];
}

function describeFile(video: IDemoVideo): string {
  const size = `${(video.bytes / 1_000_000).toFixed(1)} MB`;
  return video.modified === undefined ? size : `${new Date(video.modified).toLocaleString()} · ${size}`;
}

export function VideoSection({ heading, layout, emptyMessage, videos }: IVideoSectionProps): JSX.Element {
  const headingId = useId();

  return (
    <section className="video-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {videos.length === 0 ? (
        <p>{emptyMessage}</p>
      ) : (
        <ul className={`video-list video-list--${layout}`}>
          {videos.map((video) => (
            <li key={video.id}>
              <figure className="video-card">
                <video controls preload="metadata" poster={video.poster} src={video.src} aria-label={video.title}>
                  {video.captions !== undefined && (
                    <track kind="captions" srcLang="en" label="English" src={video.captions} />
                  )}
                </video>
                <figcaption>
                  <strong>{video.title}</strong>
                  <span>{describeFile(video)}</span>
                  <a href={video.src}>Open the file</a>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
