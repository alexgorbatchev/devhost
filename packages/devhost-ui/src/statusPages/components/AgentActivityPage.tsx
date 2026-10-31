import { Badge, Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@alexgorbatchev/shadcn";
import type { ReactElement } from "react";
import { useAgentActivity } from "../hooks/useAgentActivity";

interface IAgentActivityPageProps {
  title: string;
  message: string;
  streamURL: string;
}

/**
 * Shows what agents do as they do it. This page is served only on the control server's own origin: events can hold
 * anything an agent read, and no application's scripts share that origin.
 */
export function AgentActivityPage({ title, message, streamURL }: IAgentActivityPageProps): ReactElement {
  const { events, isConnected } = useAgentActivity(streamURL);
  return (
    <main
      data-testid="AgentActivityPage"
      className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-8 wrap-anywhere"
    >
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 id="title">{title}</h1>
          <Badge variant="secondary">{isConnected ? "Live" : "Reconnecting"}</Badge>
        </div>
        <p>{message}</p>
      </header>
      {events.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Waiting for activity</EmptyTitle>
            <EmptyDescription>Events appear here as agents work. History is not shown.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((event, index) => (
            <li key={`${event.pid}:${event.timestamp}:${events.length - index}`} data-testid="AgentActivityPage--event">
              <p className={event.isError ? "text-destructive" : "text-muted-foreground"}>
                {[
                  new Date(event.timestamp).toLocaleTimeString(),
                  event.harness,
                  event.eventType,
                  event.toolName,
                  event.role,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {event.text ? <pre className="whitespace-pre-wrap">{event.text}</pre> : null}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
