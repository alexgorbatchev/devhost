import { z } from "zod";
import type { NativeBrowserUpdate } from "./types";

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const observation = z
  .strictObject({
    isConnected: z.boolean(),
    documentState: z.enum(["unbound", "ambiguous", "bound"]),
    isReactAvailable: z.boolean(),
    isNativeWindowOpen: z.boolean(),
    isNativeSessionLost: z.boolean(),
    browserVersion: z.string(),
    message: z.string(),
  })
  .refine(
    (state) =>
      !state.isReactAvailable || (state.isConnected && state.documentState === "bound" && !state.isNativeSessionLost),
    {
      message: "React availability requires a connected, uniquely bound, intact native session.",
    },
  );
const update = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("state"),
    id: requestId.optional(),
    revision: z.number().int().positive(),
    state: observation,
    error: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("error"), id: requestId.optional(), error: z.string() }),
]);

export function parseNativeBrowserUpdate(value: unknown): NativeBrowserUpdate | null {
  const parsed = update.safeParse(value);
  return parsed.success ? parsed.data : null;
}
