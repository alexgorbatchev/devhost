import { z } from "zod";
import type { ChatServerFrame, IChatHarness, IChatSession } from "./types";

const requestId = z.union([z.string(), z.number().int().safe()]);
const sessionSchema = z.object({
  id: z.string(),
  harness: z.enum(["codex", "claude-code"]),
  projectRootPath: z.string(),
  nativeSessionId: z.string().optional(),
  status: z.enum(["starting", "idle", "running", "requires_action", "closed", "error"]),
  error: z.string().optional(),
});
const eventSchema = z.object({ sequence: z.number().int().nonnegative().safe(), payload: z.unknown() });
const serverFrame = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("command_result"),
    sessionId: z.string(),
    commandId: z.string().min(1),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal("snapshot"),
    sessionId: z.string(),
    session: sessionSchema,
    events: z.array(eventSchema).optional(),
    pendingRequestIds: z.array(requestId),
  }),
  z.object({
    type: z.literal("event"),
    sessionId: z.string(),
    sequence: z.number().int().nonnegative().safe(),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("state"),
    sessionId: z.string(),
    session: sessionSchema,
    pendingRequestIds: z.array(requestId),
  }),
  z.object({ type: z.literal("error"), sessionId: z.string().optional(), error: z.string() }),
]);
const harnessSchema = z.object({
  id: z.enum(["codex", "claude-code"]),
  label: z.string(),
  available: z.boolean(),
  models: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  error: z.string().optional(),
});

export function readChatServerFrame(value: unknown): ChatServerFrame {
  return serverFrame.parse(value);
}
export function readChatSession(value: unknown): IChatSession {
  return sessionSchema.parse(value);
}
export function readChatHarnesses(value: unknown): readonly IChatHarness[] {
  return z.object({ harnesses: z.array(harnessSchema) }).parse(value).harnesses;
}
export function readChatSessions(value: unknown): readonly IChatSession[] {
  return z.object({ sessions: z.array(sessionSchema) }).parse(value).sessions;
}
