import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "playwright";
import type { NativeReactInspector } from "./NativeReactInspector";
import type { INativeReactProject } from "./types";
import { exerciseNativeReactCommands } from "./exerciseNativeReactCommands";
import { activateNativeReactFixtureControl } from "./activateNativeReactFixtureControl";

interface INativeReactLifecycleOptions {
  host: Page;
  inspector: NativeReactInspector;
  project: INativeReactProject;
  outputPath: string;
  sibling: Page;
  siblingInspector: NativeReactInspector;
}

export async function connectNativeReactControl(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Connect browser control", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Browser control is connected." }).waitFor();
  assert.equal(
    await page.getByRole("status").filter({ hasText: "Browser control is connected." }).textContent(),
    "Browser control is connected.",
  );
  await page.getByRole("button", { name: "React DevTools", exact: true }).waitFor();
}

export async function disconnectNativeReactControl(page: Page): Promise<void> {
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
  const command = host.getByRole("button", { name: "Disconnect browser control", exact: true });
  const readout = host.getByRole("region", { name: "Native browser control status", exact: true });
  await host.getByRole("button", { name: "React DevTools", exact: true }).click();
  await inspector.assertWindowPreserved();
  const commandEvidence = await exerciseNativeReactCommands({
    host,
    inspector,
    project,
    outputPath: options.outputPath,
  });
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
  assert.equal(await command.count(), 0);
  assert.equal(await readout.count(), 0);
  await assertHostIncrement(host, project.name, 4);
  await inspector.assertComponents(4);
  await host.getByRole("button", { name: "Expand devhost toolbar", exact: true }).click();
  await host.getByRole("button", { name: "Disconnect browser control", exact: true }).waitFor();
  await readout.waitFor();
  await host.getByRole("button", { name: "Disable external tools", exact: true }).click();
  await command.waitFor({ state: "detached" });
  await readout.waitFor({ state: "detached" });
  await assertHostIncrement(host, project.name, 5);
  await inspector.assertComponents(5);
  await host.getByRole("button", { name: "Enable external tools", exact: true }).click();
  await connectNativeReactControl(host);
  await host.getByRole("button", { name: "React DevTools", exact: true }).click();
  await inspector.assertWindowPreserved();
  const appRoot = host.getByTestId("DevtoolsTopLayer");
  await appRoot.waitFor({ state: "visible" });
  assert.equal(await appRoot.count(), 1, "The actual App root must exist before unmount.");
  const originalAppRoot = await appRoot.elementHandle();
  assert(originalAppRoot);
  assert.equal(
    await originalAppRoot.evaluate(
      (element) =>
        element.isConnected &&
        element ===
          document.getElementById("devhost-devtools-host")?.shadowRoot?.querySelector("[data-testid=DevtoolsTopLayer]"),
    ),
    true,
    "The positive root must belong to this fixture App owner.",
  );
  await activateNativeReactFixtureControl(host, "Unmount actual App root", options.outputPath);
  await command.waitFor({ state: "detached" });
  await appRoot.waitFor({ state: "detached" });
  assert.equal(await appRoot.count(), 0);
  assert.equal(await originalAppRoot.evaluate((element) => element.isConnected), false);
  await originalAppRoot.dispose();
  await readout.waitFor({ state: "detached" });
  await assertHostIncrement(host, project.name, 6);
  await inspector.assertComponents(6);
  await activateNativeReactFixtureControl(host, "Mount actual App root", options.outputPath);
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
  await activateNativeReactFixtureControl(host, "Unmount host root", options.outputPath);
  await host.getByRole("button", { name: "React DevTools", exact: true }).waitFor({ state: "detached" });
  await activateNativeReactFixtureControl(host, "Mount host root", options.outputPath);
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
        directCommandEvidence: commandEvidence,
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
