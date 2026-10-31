import { useEffect, useState } from "react";
import { z } from "zod";
import { openReconnectingWebSocket } from "../../devtools/shared/openReconnectingWebSocket";

const MAXIMUM_EVENTS = 500;
const eventSchema = z.object({
  harness: z.string(),
  pid: z.number(),
  eventType: z.string(),
  timestamp: z.number(),
  role: z.string().optional(),
  toolName: z.string().optional(),
  text: z.string().optional(),
  isError: z.boolean().optional(),
});

export type AgentActivityEvent = z.infer<typeof eventSchema>;

interface IAgentActivityView {
  events: readonly AgentActivityEvent[];
  isConnected: boolean;
}

/** Streams the checkout's agent events, newest first. The server's watcher runs only while this connection is open. */
export function useAgentActivity(streamURL: string): IAgentActivityView {
  const [events, setEvents] = useState<readonly AgentActivityEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  useEffect(() => {
    const stream = openReconnectingWebSocket(streamURL, {
      onOpen: () => setIsConnected(true),
      onMessage(message): void {
        if (typeof message.data !== "string") return;
        const event = eventSchema.parse(JSON.parse(message.data));
        setEvents((current) => [event, ...current].slice(0, MAXIMUM_EVENTS));
      },
      onDisconnect: () => setIsConnected(false),
      onEnd: () => setIsConnected(false),
    });
    return () => stream.close();
  }, [streamURL]);
  return { events, isConnected };
}
