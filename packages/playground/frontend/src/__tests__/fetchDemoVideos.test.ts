import { describe, expect, test } from "bun:test";
import { fetchDemoVideos } from "../fetchDemoVideos";
import type { IDemoVideo } from "../types";

const promo: IDemoVideo = {
  id: "recording-oNisDg",
  kind: "recording",
  title: "recording-oNisDg",
  src: "/demo-videos/recordings/recording-oNisDg/devhost-demo.mp4",
  poster: "/demo-videos/recordings/recording-oNisDg/poster.png",
  modified: "2026-10-09T16:58:00.000Z",
  bytes: 24_440_071,
};

describe("fetchDemoVideos", () => {
  test("fetches the same-origin video list and forwards query cancellation", async () => {
    const controller = new AbortController();
    const requests: Request[] = [];
    const fetcher = async (input: string, init: RequestInit): Promise<Response> => {
      requests.push(new Request(new URL(input, "http://playground.localhost"), init));
      return Response.json([promo]);
    };

    expect(await fetchDemoVideos(fetcher, controller.signal)).toEqual([promo]);
    expect(requests.map((request) => request.url)).toEqual(["http://playground.localhost/demo-videos/index.json"]);
    controller.abort();
    expect(requests[0]?.signal.aborted).toBe(true);
  });

  test("rejects unsuccessful HTTP responses so the page shows an error", async () => {
    const fetcher = async (): Promise<Response> => new Response("Unavailable", { status: 503 });

    await expect(fetchDemoVideos(fetcher, new AbortController().signal)).rejects.toThrow(
      "Video list request failed: 503",
    );
  });

  test("accepts a published video, which GitHub serves and which has no file time", async () => {
    const published: IDemoVideo = {
      id: "published-annotations",
      kind: "published",
      title: "annotations",
      src: "https://github.com/alexgorbatchev/devhost/releases/download/media/annotations-273a29aa49b00e5f.mp4",
      bytes: 1_151_684,
    };
    const fetcher = async (): Promise<Response> => Response.json([promo, published]);

    expect(await fetchDemoVideos(fetcher, new AbortController().signal)).toEqual([promo, published]);
  });

  test.each([
    ["an object", { videos: [promo] }],
    ["a file time that is not text", [{ ...promo, modified: 1_791_500_000 }]],
    ["a video without a source", [{ ...promo, src: undefined }]],
    ["a video of an unknown kind", [{ ...promo, kind: "trailer" }]],
    ["a poster that is not a path", [{ ...promo, poster: 7 }]],
  ])("rejects %s instead of rendering it", async (_name, body) => {
    const fetcher = async (): Promise<Response> => Response.json(body);

    await expect(fetchDemoVideos(fetcher, new AbortController().signal)).rejects.toThrow(
      "Video list response is not a list of videos",
    );
  });
});
