import { useEffect, useRef, useState } from "preact/hooks";

import { LOGS_WEBSOCKET_PATH, maximumRetainedLogEntries } from "../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import type { ServiceLogEntry, ServiceLogMessage } from "../../shared/types";

const normalClosureCode: number = 1_000;

export function useServiceLogs(isPaused: boolean): ServiceLogEntry[] {
  const [entries, setEntries] = useState<ServiceLogEntry[]>([]);
  const entriesReference = useRef<ServiceLogEntry[]>(entries);
  const isPausedReference = useRef<boolean>(isPaused);
  const pendingEntriesReference = useRef<ServiceLogEntry[] | null>(null);

  entriesReference.current = entries;
  isPausedReference.current = isPaused;

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
        applyIncomingEntries(limitRetainedLogEntries(message.entries));
        return;
      }

      const nextEntries: ServiceLogEntry[] = limitRetainedLogEntries([
        ...(pendingEntriesReference.current ?? entriesReference.current),
        message.entry,
      ]);

      applyIncomingEntries(nextEntries);
    };

    websocket = new WebSocket(createDevtoolsWebSocketUrl(LOGS_WEBSOCKET_PATH, window.location));
    websocket.addEventListener("message", handleMessage);

    return () => {
      if (websocket !== null && websocket.readyState !== WebSocket.CLOSED) {
        websocket.close(normalClosureCode, "devtools unmounted");
      }
    };
  }, []);

  useEffect(() => {
    if (isPaused || pendingEntriesReference.current === null) {
      return;
    }

    setEntries(pendingEntriesReference.current);
    pendingEntriesReference.current = null;
  }, [isPaused]);

  return entries;

  function applyIncomingEntries(nextEntries: ServiceLogEntry[]): void {
    if (isPausedReference.current) {
      pendingEntriesReference.current = nextEntries;
      return;
    }

    setEntries(nextEntries);
  }
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
