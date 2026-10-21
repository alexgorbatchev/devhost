import type { IWorktreeRepository } from "../types";
import type { StateStorage } from "zustand/middleware";

export function factory_settingsStorage(): StateStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

export function factory_deniedSettingsStorage(): StateStorage {
  throw new DOMException("The browser denied storage access.", "SecurityError");
}

export function factory_fullSettingsStorage(): StateStorage {
  const storage = factory_settingsStorage();
  storage.setItem("setting", "previous");
  return {
    ...storage,
    setItem: () => {
      throw new DOMException("Storage quota exceeded.", "QuotaExceededError");
    },
  };
}

/** A repository configured at `/projects/shop` with two more checkouts under `/worktrees`. */
export function factory_worktreeRepository(): IWorktreeRepository {
  return {
    id: "shop",
    name: "shop",
    configuredPath: "/projects/shop",
    defaultBranch: "main",
    selectedPath: "/projects/shop",
    runningPath: "/projects/shop",
    switching: false,
    serviceNames: ["api", "web"],
    worktrees: [
      { path: "/projects/shop", branch: "main", head: "abcdef123", detached: false, available: true, directories: [] },
      {
        path: "/worktrees/cart",
        branch: "feature/cart",
        head: "123456789",
        detached: false,
        available: true,
        directories: [],
      },
      {
        path: "/worktrees/experiment",
        branch: "",
        head: "deadbeef12",
        detached: true,
        available: true,
        directories: [],
      },
    ],
  };
}
