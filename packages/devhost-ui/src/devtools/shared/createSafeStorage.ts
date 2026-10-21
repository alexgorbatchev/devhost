import type { StateStorage } from "zustand/middleware";
import type { GetSettingsStorage } from "./types";

/** Storage denial or quota exhaustion must not interrupt the injected application. */
export function createSafeStorage(getStorage: GetSettingsStorage): StateStorage {
  return {
    getItem(name) {
      try {
        return getStorage().getItem(name);
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      try {
        return getStorage().setItem(name, value);
      } catch {
        return undefined;
      }
    },
    removeItem(name) {
      try {
        return getStorage().removeItem(name);
      } catch {
        return undefined;
      }
    },
  };
}
