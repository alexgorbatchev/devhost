import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { NativeReactInspector } from "./NativeReactInspector";
import type { INativeReactProject } from "./types";

interface INativeReactLifecycleOptions {
  host: Page;
  inspector: NativeReactInspector;
  project: INativeReactProject;
  outputPath: string;
  sibling: Page;
  siblingInspector: NativeReactInspector;
}

export async function connectNativeReactControl(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Native browser connection", exact: true });
  await trigger.waitFor();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.getByRole("button", { name: "Connect browser control", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Browser control is connected." }).waitFor();
  assert.equal(
    await page.getByRole("status").filter({ hasText: "Browser control is connected." }).textContent(),
    "Browser control is connected.",
  );
  await page.getByRole("button", { name: "React DevTools", exact: true }).waitFor();
}

export async function disconnectNativeReactControl(page: Page): Promise<void> {
  const trigger = page.getByRole("button", { name: "Native browser connection", exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.getByRole("button", { name: "Disconnect browser control", exact: true }).click();
  await page.getByRole("button", { name: "Connect browser control", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
}

async function assertHostIncrement(page: Page, project: string, count: number): Promise<void> {
  await page.getByRole("button", { name: `Increment host ${project}`, exact: true }).click();
  await page.waitForFunction(
    (expected) => document.querySelector('output[aria-label="Host count"]')?.textContent === String(expected),
    count,
  );
  assert.equal(await page.getByLabel("Host count", { exact: true }).textContent(), String(count));
}

export async function exerciseNativeReactLifecycle(options: INativeReactLifecycleOptions): Promise<void> {
  const { host, inspector, project, sibling, siblingInspector } = options;
  await host.getByRole("status").filter({ hasText: "Browser control is connected." }).waitFor();
  const trigger = host.getByRole("button", { name: "Native browser connection", exact: true });
  await host.getByRole("button", { name: "Disconnect browser control", exact: true }).focus();
  await host.keyboard.press("Escape");
  await host.waitForFunction(
    () =>
      document
        .getElementById("devhost-devtools-host")
        ?.shadowRoot?.querySelector('button[aria-label="Native browser connection"]')
        ?.getAttribute("aria-expanded") === "false",
  );
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  assert.equal(
    await trigger.evaluate((element) => {
      const root = element.getRootNode();
      return root instanceof ShadowRoot && element === root.activeElement;
    }),
    true,
  );
  await host.getByRole("button", { name: "React DevTools", exact: true }).click();
  await inspector.assertWindowPreserved();
  await assertHostIncrement(host, project.name, 1);
  await inspector.assertComponents(1);
  await inspector.startRecording();
  await assertHostIncrement(host, project.name, 2);
  await disconnectNativeReactControl(host);
  await assertHostIncrement(host, project.name, 3);
  await inspector.assertComponents(3);
  await sibling.getByRole("button", { name: "Increment host B", exact: true }).click();
  await siblingInspector.assertComponents(1);
  await connectNativeReactControl(host);
  await host.getByRole("button", { name: "Collapse devhost toolbar", exact: true }).click();
  assert.equal(await host.getByRole("button", { name: "Native browser connection", exact: true }).count(), 0);
  await assertHostIncrement(host, project.name, 4);
  await inspector.assertComponents(4);
  await host.getByRole("button", { name: "Expand devhost toolbar", exact: true }).click();
  await trigger.click();
  await host.getByRole("button", { name: "Disconnect browser control", exact: true }).waitFor();
  await host.getByRole("button", { name: "Disable external tools", exact: true }).click();
  await trigger.waitFor({ state: "detached" });
  await assertHostIncrement(host, project.name, 5);
  await inspector.assertComponents(5);
  await host.getByRole("button", { name: "Enable external tools", exact: true }).click();
  await connectNativeReactControl(host);
  await host.getByRole("button", { name: "React DevTools", exact: true }).click();
  await inspector.assertWindowPreserved();
  await host.getByRole("button", { name: "Unmount actual App root", exact: true }).click();
  await trigger.waitFor({ state: "detached" });
  await assertHostIncrement(host, project.name, 6);
  await inspector.assertComponents(6);
  await host.getByRole("button", { name: "Mount actual App root", exact: true }).click();
  await connectNativeReactControl(host);
  await assertHostIncrement(host, project.name, 7);
  await inspector.assertComponents(7);
  await project.stop();
  await host.getByRole("button", { name: "Connect browser control", exact: true }).waitFor();
  assert.equal(await host.getByRole("button", { name: "React DevTools", exact: true }).count(), 0);
  await assertHostIncrement(host, project.name, 8);
  await inspector.assertComponents(8);
  await sibling.getByRole("button", { name: "Increment host B", exact: true }).click();
  await siblingInspector.assertComponents(2);
  await project.start();
  await connectNativeReactControl(host);
  await assertHostIncrement(host, project.name, 9);
  await inspector.assertComponents(9);
  await inspector.finishRecording(8);
  await host.getByRole("button", { name: "Unmount host root", exact: true }).click();
  await host.getByRole("button", { name: "React DevTools", exact: true }).waitFor({ state: "detached" });
  await host.getByRole("button", { name: "Mount host root", exact: true }).click();
  await host.getByRole("button", { name: "React DevTools", exact: true }).waitFor();
  await inspector.assertComponents(0);
  await inspector.startRecording();
  await assertHostIncrement(host, project.name, 1);
  await inspector.assertComponents(1);
  await inspector.finishRecording(1);
  await disconnectNativeReactControl(host);
  await sibling.getByRole("button", { name: "Increment host B", exact: true }).click();
  await siblingInspector.assertComponents(3);
  await inspector.assertWindowPreserved();
  await Bun.write(
    resolve(options.outputPath, "lifecycle-assertions.json"),
    JSON.stringify(
      {
        isTrustedEscapeExercised: true,
        hasActualAppRootUnmount: true,
        hasDisabledPositiveRecovery: true,
        hasStrictModePositiveRecovery: true,
        hasActualGoStopRestart: true,
        hostCommitCounts: [8, 1],
        siblingLiveState: 3,
        actualAppOwner: "fixture imported production App; compiled injection acceptance is a separate page",
      },
      null,
      2,
    ),
  );
}
