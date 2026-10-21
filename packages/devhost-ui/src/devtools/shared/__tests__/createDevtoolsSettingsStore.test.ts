import { describe, expect, it, mock } from "bun:test";
import { createDevtoolsSettingsStore } from "../createDevtoolsSettingsStore";
import { factory_deniedSettingsStorage, factory_settingsStorage } from "./fixtures";

describe("createDevtoolsSettingsStore", () => {
  it("rehydrates updated settings in a new store and retains its live actions", () => {
    const storage = factory_settingsStorage();
    const scope = { projectRootPath: "/shop", pageURL: "https://app.localhost/cart" };
    const first = createDevtoolsSettingsStore(scope, () => storage);
    first.getState().updateChat({ isOpen: true, side: "left", draft: "Review cart", sessionId: "native-one" });
    first.getState().updateChat({
      selectedHarness: "claude-code",
      selectedModel: "installed-model",
      scroll: { top: 250, left: 0, isAtBottom: false },
    });
    const second = createDevtoolsSettingsStore(scope, () => storage);
    expect(second.getState().chat).toEqual(first.getState().chat);
    const changed = mock();
    second.subscribe(changed);
    second.getState().updateChat({ isOpen: false });
    expect(changed).toHaveBeenCalledTimes(1);
    const third = createDevtoolsSettingsStore(scope, () => storage);
    expect(third.getState().chat.isOpen).toBe(false);
    expect(third.getState().chat.draft).toBe("Review cart");
  });

  it("isolates projects, pages and origins sharing the same storage", () => {
    const storage = factory_settingsStorage();
    const first = createDevtoolsSettingsStore(
      { projectRootPath: "/shop", pageURL: "https://app.localhost/cart" },
      () => storage,
    );
    first.getState().updateChat({ isOpen: true, draft: "Private cart review" });
    const anotherProject = createDevtoolsSettingsStore(
      { projectRootPath: "/other", pageURL: "https://app.localhost/cart" },
      () => storage,
    );
    const anotherPage = createDevtoolsSettingsStore(
      { projectRootPath: "/shop", pageURL: "https://app.localhost/profile" },
      () => storage,
    );
    const anotherOrigin = createDevtoolsSettingsStore(
      { projectRootPath: "/shop", pageURL: "https://other.localhost/cart" },
      () => storage,
    );
    expect(anotherProject.getState().chat.draft).toBe("");
    expect(anotherPage.getState().chat.draft).toBe("");
    expect(anotherOrigin.getState().chat.draft).toBe("");
    anotherProject.getState().updateChat({ draft: "Other project" });
    expect(
      createDevtoolsSettingsStore(
        { projectRootPath: "/shop", pageURL: "https://app.localhost/cart" },
        () => storage,
      ).getState().chat.draft,
    ).toBe("Private cart review");
  });

  it.each([
    "{invalid JSON",
    JSON.stringify({ state: { chat: { side: "up", draft: "bad" } }, version: 1 }),
    JSON.stringify({ state: { chat: { scroll: { top: -10, left: 0, isAtBottom: false } } }, version: 1 }),
    JSON.stringify({ state: { chat: { isOpen: true, draft: "future schema" } }, version: 99 }),
  ])("discards invalid saved data and can save again: %s", (saved) => {
    const storage = factory_settingsStorage();
    const scope = { projectRootPath: "/shop", pageURL: "https://app.localhost/" };
    storage.setItem(`devhost:settings:${JSON.stringify([scope.projectRootPath, scope.pageURL])}`, saved);
    const store = createDevtoolsSettingsStore(scope, () => storage);
    expect(store.getState().chat.draft).toBe("");
    expect(store.getState().chat.isOpen).toBe(false);
    store.getState().updateChat({ draft: "Valid replacement" });
    expect(createDevtoolsSettingsStore(scope, () => storage).getState().chat.draft).toBe("Valid replacement");
  });

  it("keeps working in memory when the browser denies access to storage", () => {
    const store = createDevtoolsSettingsStore(
      { projectRootPath: "/shop", pageURL: "https://app.localhost/" },
      factory_deniedSettingsStorage,
    );
    expect(() => store.getState().updateChat({ isOpen: true, draft: "Keep editing" })).not.toThrow();
    expect(store.getState().chat.draft).toBe("Keep editing");
    expect(store.getState().chat.isOpen).toBe(true);
  });
});
