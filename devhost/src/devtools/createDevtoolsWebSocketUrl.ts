export function createDevtoolsWebSocketUrl(
  path: string,
  location: Pick<Location, "host" | "protocol">,
): string {
  const protocol: string = location.protocol === "https:" ? "wss:" : "ws:";

  return new URL(path, `${protocol}//${location.host}`).toString();
}
