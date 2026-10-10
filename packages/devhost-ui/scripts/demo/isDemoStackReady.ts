// Whether the stack's API answers and its page loads in a browser. devhost answers a navigation with its own
// startup page until the service passes its health check, while other requests already reach the app, so the page
// is requested the way a navigation requests it. The certificate is the managed Caddy's root, for HTTPS.
export async function isDemoStackReady(url: string, signal: AbortSignal, certificate?: string): Promise<boolean> {
  const isAnswering = async (path: string, headers: Record<string, string>): Promise<boolean> => {
    const response = await fetch(new URL(path, url), {
      headers,
      tls: certificate === undefined ? undefined : { ca: certificate },
      signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
    });
    await response.body?.cancel();
    return response.ok;
  };
  return (await isAnswering("/api/hello", {})) && (await isAnswering("/", { "Sec-Fetch-Dest": "document" }));
}
