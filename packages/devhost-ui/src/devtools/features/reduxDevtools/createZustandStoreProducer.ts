import { stringifyJSON } from "@redux-devtools/app-core";
import { parse } from "jsan";
import type { IReduxDevtoolsProducer, IZustandDevtoolsRegistrationOptions, ProducerMessage } from "./types";

export function createZustandStoreProducer<State, Snapshot>(
  options: IZustandDevtoolsRegistrationOptions<State, Snapshot>,
  instanceId: string,
): IReduxDevtoolsProducer {
  if (
    (typeof options.store !== "object" && typeof options.store !== "function") ||
    options.store === null ||
    typeof options.store.getState !== "function" ||
    typeof options.store.getInitialState !== "function" ||
    typeof options.store.setState !== "function" ||
    typeof options.store.subscribe !== "function" ||
    typeof options.snapshot !== "function" ||
    typeof options.restore !== "function"
  )
    throw new Error("Zustand DevTools requires a real StoreApi and explicit snapshot/restore functions.");
  let send: ((message: ProducerMessage) => void) | undefined;
  let nextActionId = 2;
  let isReplaying = false;
  const initialize = (): void => {
    nextActionId = 2;
    send?.({
      type: "INIT",
      id: instanceId,
      instanceId,
      name: options.name,
      payload: stringifyJSON(options.snapshot(options.store.getState()), true),
      libConfig: {
        name: options.name,
        type: "zustand",
        serialize: true,
        features: {
          jump: true,
          export: true,
          import: false,
          skip: false,
          reorder: false,
          pause: false,
          lock: false,
          dispatch: false,
          persist: false,
          sync: false,
          test: false,
        },
      },
    });
  };
  const restore = (snapshot: unknown): void => {
    const partial = options.restore(snapshot, options.store.getState());
    isReplaying = true;
    try {
      options.store.setState(partial);
    } finally {
      isReplaying = false;
    }
  };
  return {
    kind: "zustand",
    subscribe: (publish) => {
      send = publish;
      const unsubscribe = options.store.subscribe((state) => {
        if (isReplaying) return;
        try {
          const payload = stringifyJSON(options.snapshot(state), true);
          publish({
            type: "ACTION",
            id: instanceId,
            instanceId,
            name: options.name,
            action: stringifyJSON({ action: { type: "zustand/setState" }, timestamp: Date.now() }, true),
            payload,
            nextActionId: nextActionId++,
            maxAge: 50,
          });
        } catch (error) {
          publish({ type: "ERROR", id: instanceId, message: error instanceof Error ? error.message : String(error) });
        }
      });
      try {
        initialize();
      } catch (error) {
        unsubscribe();
        send = undefined;
        throw error;
      }
      return () => {
        unsubscribe();
        send = undefined;
      };
    },
    receive: (message) => {
      const action = message.action;
      if (typeof action !== "object" || action === null || !("type" in action))
        throw new Error("Invalid Zustand DevTools action.");
      switch (action.type) {
        case "JUMP_TO_STATE":
        case "JUMP_TO_ACTION":
          if (message.state === undefined)
            throw new Error("Zustand replay requires the native monitor's serialized target state.");
          restore(parse(message.state));
          return;
        case "ROLLBACK":
          if (message.state === undefined)
            throw new Error("Zustand revert requires the native monitor's committed state.");
          restore(parse(message.state));
          initialize();
          return;
        case "RESET":
          restore(options.snapshot(options.store.getInitialState()));
          initialize();
          return;
        case "COMMIT":
          initialize();
          return;
        default:
          throw new Error("Unsupported Zustand DevTools control.");
      }
    },
  };
}
