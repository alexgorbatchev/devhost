import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { NativeReactInspector } from "./NativeReactInspector";
import { connectNativeReactControl } from "./exerciseNativeReactLifecycle";

interface INativeReactLossOptions {
  host: Page;
  inspector: NativeReactInspector;
  outputPath: string;
}

export async function exerciseNativeReactLoss(options: INativeReactLossOptions): Promise<void> {
  const { host, inspector } = options;
  await connectNativeReactControl(host);
  await inspector.assertComponents(1);
  await inspector.closeNativeWindowForLoss();
  await host
    .getByText("The native React session was lost. Inspection recovery remains unverified.", { exact: true })
    .waitFor();
  assert.equal(await host.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
  await host.getByRole("button", { name: "Disable external tools", exact: true }).click();
  await host.getByRole("button", { name: "Native browser connection", exact: true }).waitFor({ state: "detached" });
  await host.getByRole("button", { name: "Enable external tools", exact: true }).click();
  const trigger = host.getByRole("button", { name: "Native browser connection", exact: true });
  await trigger.click();
  await host.getByRole("button", { name: "Connect browser control", exact: true }).click();
  await host
    .getByText("The native React session was lost. Inspection recovery remains unverified.", { exact: true })
    .waitFor();
  assert.equal(await host.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
  await Bun.write(resolve(options.outputPath, "native-loss-only.snapshot"), await host.locator("body").ariaSnapshot());
  // No Open, reload, reconnect recovery or private React tab operation follows.
  // This checks retained truthful loss in the same actual mounted App lifetime.
}
