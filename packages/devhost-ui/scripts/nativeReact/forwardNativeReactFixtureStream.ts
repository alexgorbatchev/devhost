import type { WebSocketRoute } from "playwright";

interface INativeReactFixtureStream {
  url: string;
  events: unknown[];
  hasPageClosed: boolean;
  hasServerClosed: boolean;
  close: () => Promise<void>;
}

export function forwardNativeReactFixtureStream(
  route: WebSocketRoute,
  closeTasks: Promise<void>[],
): INativeReactFixtureStream {
  const server = route.connectToServer();
  const stream: INativeReactFixtureStream = {
    url: route.url(),
    events: [],
    hasPageClosed: false,
    hasServerClosed: false,
    close: () => server.close(),
  };
  route.onMessage((message) => {
    stream.events.push({ direction: "page", payload: message, recordedAt: new Date().toISOString() });
    server.send(message);
  });
  server.onMessage((message) => {
    stream.events.push({
      direction: "server",
      payload: message,
      hasPageClosed: stream.hasPageClosed,
      recordedAt: new Date().toISOString(),
    });
    // Installed Playwright's unmatched passthrough forwards even when the
    // Page socket closed before its asynchronous native connection started.
    // Preserve native close semantics instead of delivering into that side.
    if (!stream.hasPageClosed) route.send(message);
  });
  route.onClose((code, reason) => {
    stream.hasPageClosed = true;
    stream.events.push({ direction: "page-close", code, reason, recordedAt: new Date().toISOString() });
    closeTasks.push(server.close({ code, reason }));
  });
  server.onClose((code, reason) => {
    stream.hasServerClosed = true;
    stream.events.push({ direction: "server-close", code, reason, recordedAt: new Date().toISOString() });
    closeTasks.push(route.close({ code, reason }));
  });
  return stream;
}
