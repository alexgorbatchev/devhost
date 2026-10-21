import type { IChatSnapshot } from "../features/agentChat/types";

export const fixture_savedChatSnapshot: IChatSnapshot = {
  type: "snapshot",
  sessionId: "saved-conversation",
  session: { id: "saved-conversation", harness: "codex", projectRootPath: "/project", status: "idle" },
  pendingRequestIds: [],
  events: Array.from({ length: 30 }, (_, index) => ({
    sequence: index + 1,
    payload: {
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          id: `reply-${index}`,
          text: `Reply ${index + 1}: ${"Saved conversation history. ".repeat(10)}`,
        },
      },
    },
  })),
};

export const fixture_runningChatSnapshot: IChatSnapshot = {
  ...fixture_savedChatSnapshot,
  session: { ...fixture_savedChatSnapshot.session, status: "running" },
};
