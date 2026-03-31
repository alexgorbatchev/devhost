import { useEffect, useState } from "preact/hooks";

import { LOGS_WEBSOCKET_PATH, maximumRetainedLogEntries } from "./constants";
import { createDevtoolsWebSocketUrl } from "./createDevtoolsWebSocketUrl";
import type { ServiceLogEntry, ServiceLogMessage } from "./types";

const normalClosureCode: number = 1_000;

export function useServiceLogs(): ServiceLogEntry[] {
  const [entries, setEntries] = useState<ServiceLogEntry[]>([]);

  useEffect(() => {
    let websocket: WebSocket | null = null;

    const handleMessage = (event: MessageEvent): void => {
      if (typeof event.data !== "string") {
        return;
      }

      const message: ServiceLogMessage | null = parseServiceLogMessage(event.data);

      if (message === null) {
        return;
      }

      if (message.type === "snapshot") {
        setEntries(limitRetainedLogEntries(message.entries));
        return;
      }

      setEntries((currentEntries: ServiceLogEntry[]): ServiceLogEntry[] => {
        return limitRetainedLogEntries([...currentEntries, message.entry]);
      });
    };

    websocket = new WebSocket(createDevtoolsWebSocketUrl(LOGS_WEBSOCKET_PATH, window.location));
    websocket.addEventListener("message", handleMessage);

    return () => {
      if (websocket !== null && websocket.readyState !== WebSocket.CLOSED) {
        websocket.close(normalClosureCode, "devtools unmounted");
      }
    };
  }, []);

  return entries;
}

function limitRetainedLogEntries(entries: ServiceLogEntry[]): ServiceLogEntry[] {
  if (entries.length <= maximumRetainedLogEntries) {
    return entries;
  }

  return entries.slice(entries.length - maximumRetainedLogEntries);
}

function parseServiceLogMessage(messageText: string): ServiceLogMessage | null {
  try {
    const value: unknown = JSON.parse(messageText);

    return isServiceLogMessage(value) ? value : null;
  } catch {
    return null;
  }
}

function isServiceLogMessage(value: unknown): value is ServiceLogMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const type: unknown = Reflect.get(value, "type");

  if (type === "snapshot") {
    const entries: unknown = Reflect.get(value, "entries");

    return Array.isArray(entries) && entries.every(isServiceLogEntry);
  }

  if (type === "entry") {
    return isServiceLogEntry(Reflect.get(value, "entry"));
  }

  return false;
}

function isServiceLogEntry(value: unknown): value is ServiceLogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "id") === "number" &&
    typeof Reflect.get(value, "line") === "string" &&
    typeof Reflect.get(value, "serviceName") === "string" &&
    (Reflect.get(value, "stream") === "stdout" || Reflect.get(value, "stream") === "stderr")
  );
}
