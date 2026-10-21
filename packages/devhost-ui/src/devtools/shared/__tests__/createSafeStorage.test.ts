import { expect, test } from "bun:test";
import { createSafeStorage } from "../createSafeStorage";
import { factory_deniedSettingsStorage, factory_fullSettingsStorage, factory_settingsStorage } from "./fixtures";

test("safe storage delegates reads, writes and removal to the supplied storage", () => {
  const shared = factory_settingsStorage();
  const safe = createSafeStorage(() => shared);
  safe.setItem("setting", "saved");
  expect(shared.getItem("setting")).toBe("saved");
  expect(safe.getItem("setting")).toBe("saved");
  safe.removeItem("setting");
  expect(safe.getItem("setting")).toBeNull();
});

test("denied storage access leaves all native operations safe", () => {
  const storage = createSafeStorage(factory_deniedSettingsStorage);
  expect(storage.getItem("setting")).toBeNull();
  expect(() => storage.setItem("setting", "value")).not.toThrow();
  expect(() => storage.removeItem("setting")).not.toThrow();
});

test("quota exhaustion preserves existing data and does not fail the caller", () => {
  const full = factory_fullSettingsStorage();
  const storage = createSafeStorage(() => full);
  expect(() => storage.setItem("setting", "replacement")).not.toThrow();
  expect(storage.getItem("setting")).toBe("previous");
});
