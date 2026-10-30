import { expect, test } from "bun:test";
import { createDisableHotReloadMessage } from "../createDisableHotReloadMessage";

test("asks to disable reloads for the page and client it detected", () => {
  const message = createDisableHotReloadMessage("next", "https://app.localhost/orders");
  expect(message).toContain("https://app.localhost/orders runs Next.js hot reloading");
  expect(message).toContain("server restarts on file changes");
  expect(message).toContain("how to turn it back on");
});
