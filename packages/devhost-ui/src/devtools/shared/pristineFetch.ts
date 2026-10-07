// Mock libraries like MirageJS or MSW patch `window.fetch` in the host page.
// A same-origin iframe gets a fresh realm those patches never touched, so we
// borrow its `fetch` for every devhost control-plane request in production.
//
// Tests and Storybook mock requests by swapping `globalThis.fetch`, and must
// not have those swaps bypassed. Only the production entrypoint opts in via
// `activatePristineFetch()`; all other callers transparently defer to the
// current `globalThis.fetch`.

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type WebSocketConstructor = typeof WebSocket;
type WebSocketUrl = ConstructorParameters<WebSocketConstructor>[0];
type WebSocketProtocols = ConstructorParameters<WebSocketConstructor>[1];
type WebSocketFactory = (url: WebSocketUrl, protocols?: WebSocketProtocols) => WebSocket;

let fetchStrategy: FetchFunction = (input, init) => globalThis.fetch(input, init);
let webSocketStrategy: WebSocketFactory = (url, protocols) => new globalThis.WebSocket(url, protocols);

export function activatePristineFetch(): void {
  if (typeof document === "undefined" || typeof document.createElement !== "function" || !document.body) {
    return;
  }
  const frame: HTMLIFrameElement = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  frame.style.display = "none";
  document.body.appendChild(frame);
  const frameWindow: Window | null = frame.contentWindow;
  if (frameWindow === null) {
    throw new Error("Failed to acquire pristine fetch: iframe has no contentWindow.");
  }
  fetchStrategy = frameWindow.fetch.bind(frameWindow);
  const frameWebSocket: unknown = Reflect.get(frameWindow, "WebSocket");
  if (typeof frameWebSocket === "function") {
    const Constructor = frameWebSocket as WebSocketConstructor;
    webSocketStrategy = (url, protocols) => new Constructor(url, protocols);
  }
}

export const pristineFetch: FetchFunction = (input, init) => fetchStrategy(input, init);

export function pristineWebSocket(url: WebSocketUrl, protocols?: WebSocketProtocols): WebSocket {
  return webSocketStrategy(url, protocols);
}
