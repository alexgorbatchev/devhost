type HelloFetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function fetchHello(fetcher: HelloFetcher, signal: AbortSignal): Promise<string> {
  const response = await fetcher("/api/hello", { signal });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  return response.text();
}
