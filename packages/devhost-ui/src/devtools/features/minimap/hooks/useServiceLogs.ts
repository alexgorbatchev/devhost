import { useEffect, useRef, useState } from "react";

import { LOGS_WEBSOCKET_PATH, maximumRetainedLogEntries } from "../../../shared/constants";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import { openReconnectingWebSocket } from "../../../shared/openReconnectingWebSocket";
import type { ServiceLogEntry, ServiceLogMessage } from "../../../shared/types";

export function useServiceLogs(isPaused: boolean): ServiceLogEntry[] {
  const [entries, setEntries] = useState<ServiceLogEntry[]>([]);
  const entriesReference = useRef<ServiceLogEntry[]>(entries);
  const isPausedReference = useRef<boolean>(isPaused);
  const pendingEntriesReference = useRef<ServiceLogEntry[] | null>(null);

  entriesReference.current = entries;
  isPausedReference.current = isPaused;

  useEffect(() => {
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

    // The entries shown stay while the stream is down; a reopened stream starts with a fresh snapshot.
    const stream = openReconnectingWebSocket(createDevtoolsWebSocketUrl(LOGS_WEBSOCKET_PATH, window.location), {
      onMessage: handleMessage,
    });

    return stream.close;
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
