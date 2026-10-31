import type { JSX } from "react";
import type { ChatDeliveryState } from "../types";

const STATUS_TEXT: Partial<Record<ChatDeliveryState, string>> = {
  queued: "Queued. The agent reads this when it next checks for input.",
  unconfirmed: "Delivery unconfirmed. Check the conversation before retrying.",
  cancelled: "Stopped before the agent read this message.",
};

interface IChatDeliveryStatusProps {
  state: ChatDeliveryState | null;
}

/** Says what became of the latest message when that differs from it simply running. A failure shows as a send error. */
export function ChatDeliveryStatus({ state }: IChatDeliveryStatusProps): JSX.Element | null {
  const text = state === null ? undefined : STATUS_TEXT[state];
  if (text === undefined) return null;
  return (
    <p data-testid="ChatDeliveryStatus" role="status" className="p-2 text-muted-foreground">
      {text}
    </p>
  );
}
