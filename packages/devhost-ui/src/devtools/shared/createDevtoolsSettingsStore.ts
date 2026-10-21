import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { z } from "zod";
import { createSafeStorage } from "./createSafeStorage";
import type {
  DevtoolsSettingsStore,
  GetSettingsStorage,
  IDevtoolsSettings,
  IDevtoolsSettingsScope,
  IDevtoolsSettingsState,
} from "./types";

const chatSchema = z.object({
  isOpen: z.boolean().default(false),
  side: z.enum(["left", "right"]).default("right"),
  selectedHarness: z.enum(["codex", "claude-code"]).default("codex"),
  selectedModel: z.string().default(""),
  sessionId: z.string().nullable().default(null),
  draft: z.string().default(""),
  scroll: z
    .object({
      top: z.number().finite().nonnegative(),
      left: z.number().finite().nonnegative(),
      isAtBottom: z.boolean(),
    })
    .nullable()
    .default(null),
});
const settingsSchema = z.object({ chat: chatSchema });

export function createDevtoolsSettingsStore(
  scope: IDevtoolsSettingsScope,
  getStorage: GetSettingsStorage,
): DevtoolsSettingsStore {
  return createStore<IDevtoolsSettingsState>()(
    persist(
      (set) => ({
        chat: chatSchema.parse({}),
        updateChat: (patch) => set((state) => ({ chat: { ...state.chat, ...patch } })),
      }),
      {
        name: `devhost:settings:${JSON.stringify([scope.projectRootPath, scope.pageURL])}`,
        version: 1,
        storage: createJSONStorage<IDevtoolsSettings>(() => createSafeStorage(getStorage)),
        partialize: (state) => ({ chat: state.chat }),
        merge: (stored, current) => {
          const result = settingsSchema.safeParse(stored);
          return result.success ? { ...current, ...result.data } : current;
        },
        // Unknown versions are discarded, never interpreted as the current schema.
        migrate: () => ({ chat: chatSchema.parse({}) }),
      },
    ),
  );
}
