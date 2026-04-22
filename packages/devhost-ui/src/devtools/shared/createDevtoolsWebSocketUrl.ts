import type { ILocationHostProtocol } from "./types";

export function createDevtoolsWebSocketUrl(path: string, location: ILocationHostProtocol): string {
  const protocol: string = location.protocol === "https:" ? "wss:" : "ws:";

  return new URL(path, `${protocol}//${location.host}`).toString();
}
