import type { ThreadMessageLike } from "@assistant-ui/react";

export type ChatMessagePart = Exclude<ThreadMessageLike["content"], string>[number];
export interface IProjectedMessage {
  id: string;
  role: ThreadMessageLike["role"];
  content: ChatMessagePart[];
  status?: ThreadMessageLike["status"];
  metadata: { custom: Record<string, unknown> };
}
