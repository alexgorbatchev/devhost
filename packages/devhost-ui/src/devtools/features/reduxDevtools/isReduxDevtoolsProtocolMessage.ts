import { z } from "zod";
import type { ProducerMessage } from "./types";

export function isReduxDevtoolsProtocolMessage(value: unknown): value is ProducerMessage {
  const base = {
    id: z.string(),
    instanceId: z.string().optional(),
    name: z.string().optional(),
    libConfig: z
      .object({
        name: z.string().optional(),
        type: z.string().optional(),
        serialize: z.boolean().optional(),
        features: z
          .object({
            jump: z.boolean().optional(),
            skip: z.boolean().optional(),
            reorder: z.boolean().optional(),
            pause: z.boolean().optional(),
            lock: z.boolean().optional(),
            export: z.union([z.string(), z.boolean()]).optional(),
            import: z.union([z.string(), z.boolean()]).optional(),
            dispatch: z.boolean().optional(),
            persist: z.boolean().optional(),
            sync: z.boolean().optional(),
            test: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
  };
  return z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("INIT"), ...base, payload: z.string() }),
      z.object({ type: z.literal("STATE"), ...base, payload: z.string(), committedState: z.unknown() }),
      z.object({
        type: z.literal("ACTION"),
        ...base,
        action: z.string(),
        payload: z.string(),
        nextActionId: z.number().int().positive(),
        maxAge: z.number().int().positive(),
      }),
      z.object({ type: z.literal("DISCONNECTED"), id: z.string() }),
      z.object({ type: z.literal("ERROR"), id: z.string(), message: z.string() }),
    ])
    .safeParse(value).success;
}
