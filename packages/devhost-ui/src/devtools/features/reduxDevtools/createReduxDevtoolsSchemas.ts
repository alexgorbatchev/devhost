import { z } from "zod";
import type { IReduxDevtoolsSchemas } from "./types";

export function createReduxDevtoolsSchemas(): IReduxDevtoolsSchemas {
  const id = z.number().int().nonnegative();
  const action = z.looseObject({ type: z.string() });
  const performed = z
    .object({ type: z.literal("PERFORM_ACTION"), action, timestamp: z.number(), stack: z.string().optional() })
    .transform((value) => ({ ...value, stack: value.stack }));
  const liftedState = z
    .object({
      monitorState: z.unknown(),
      nextActionId: id,
      actionsById: z.record(z.string(), performed),
      stagedActionIds: z.array(id).min(1),
      skippedActionIds: z.array(id),
      committedState: z.unknown(),
      currentStateIndex: id,
      computedStates: z.array(z.object({ state: z.unknown(), error: z.string().optional() })).min(1),
      isLocked: z.boolean(),
      isPaused: z.boolean(),
    })
    .refine(
      (state) =>
        state.currentStateIndex < state.computedStates.length &&
        state.stagedActionIds.length === state.computedStates.length &&
        state.stagedActionIds.every((actionId) => state.actionsById[String(actionId)] !== undefined),
      "Invalid lifted history indices.",
    );
  const liftedAction = z.discriminatedUnion("type", [
    z.object({ type: z.literal("RESET"), timestamp: z.number() }),
    z.object({ type: z.literal("ROLLBACK"), timestamp: z.number() }),
    z.object({ type: z.literal("COMMIT"), timestamp: z.number() }),
    z.object({ type: z.literal("SWEEP") }),
    z.object({ type: z.literal("JUMP_TO_STATE"), index: id }),
    z.object({ type: z.literal("JUMP_TO_ACTION"), actionId: id }),
    z.object({ type: z.literal("TOGGLE_ACTION"), id }),
    z.object({ type: z.literal("SET_ACTIONS_ACTIVE"), start: id, end: id, active: z.boolean() }),
    z.object({ type: z.literal("REORDER_ACTION"), actionId: id, beforeActionId: id }),
    z.object({ type: z.literal("LOCK_CHANGES"), status: z.boolean() }),
    z.object({ type: z.literal("PAUSE_RECORDING"), status: z.boolean() }),
    z.object({ type: z.literal("IMPORT_STATE"), nextLiftedState: liftedState, noRecompute: z.boolean().optional() }),
  ]);
  const monitorMessage = z.discriminatedUnion("type", [
    z.object({ type: z.literal("START") }),
    z.object({ type: z.literal("STOP") }),
    z.object({
      type: z.literal("DISPATCH"),
      instanceId: z.string(),
      action: z.unknown(),
      state: z.string().optional(),
      isToAll: z.boolean(),
    }),
  ]);
  const hello = z.object({ type: z.literal("DEVHOST_REDUX_HELLO"), sessionId: z.string() });
  return { liftedState, liftedAction, monitorMessage, hello };
}
