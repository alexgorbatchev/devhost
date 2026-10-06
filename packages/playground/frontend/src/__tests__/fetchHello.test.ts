import { describe, expect, test } from "bun:test";
import { fetchHello } from "../fetchHello";

describe("fetchHello", () => {
  test("fetches the same-origin backend and forwards query cancellation", async () => {
    const controller = new AbortController();
    const requests: Request[] = [];
    const fetcher = async (input: string, init: RequestInit): Promise<Response> => {
      requests.push(new Request(new URL(input, "http://playground.localhost"), init));
      return Response.json({ message: "Hello, world!", method: "GET" });
    };

    expect(await fetchHello(fetcher, controller.signal)).toBe('{"message":"Hello, world!","method":"GET"}');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("http://playground.localhost/api/hello");
    expect(requests[0]?.method).toBe("GET");
    controller.abort();
    expect(requests[0]?.signal.aborted).toBe(true);
  });

  test("rejects unsuccessful HTTP responses so Query exposes an error state", async () => {
    const fetcher = async (): Promise<Response> => new Response("Unavailable", { status: 503 });

    await expect(fetchHello(fetcher, new AbortController().signal)).rejects.toThrow("Backend request failed: 503");
  });

  test("propagates transport failures to Query", async () => {
    const fetcher = (): Promise<Response> => Promise.reject(new TypeError("Network unavailable"));

    await expect(fetchHello(fetcher, new AbortController().signal)).rejects.toThrow("Network unavailable");
  });
});
