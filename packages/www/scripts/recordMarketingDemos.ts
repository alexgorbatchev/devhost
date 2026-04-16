#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

import {
  marketingRecordingScenarios,
  readMarketingRecordingScenario,
  type IMarketingRecordingScenario,
  type MarketingRecordingScenarioId,
} from "../src/features/marketingRecording/marketingRecordingScenarios";

interface IProcessLogs {
  stderr: string[];
  stdout: string[];
}

type DevelopmentServerProcess = ReturnType<typeof spawn>;
type MouseButton = "left" | "right";
type ReadableChunk = string | Uint8Array;

interface IPoint {
  x: number;
  y: number;
}

const capturePathname: string = "/__capture__";
const serverStartupTimeoutMs: number = 20_000;
const workspaceRootPath: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordingsRootPath: string = path.join(workspaceRootPath, "public", "recordings", "marketing");

await main();

async function main(): Promise<void> {
  const requestedScenarioIds: readonly MarketingRecordingScenarioId[] = readRequestedScenarioIds(Bun.argv.slice(2));
  const scenarios: readonly IMarketingRecordingScenario[] =
    requestedScenarioIds.length === 0
      ? marketingRecordingScenarios
      : requestedScenarioIds.map((scenarioId): IMarketingRecordingScenario => {
          const scenario: IMarketingRecordingScenario | null = readMarketingRecordingScenario(scenarioId);

          if (scenario === null) {
            throw new Error(`Unknown marketing recording scenario: ${scenarioId}`);
          }

          return scenario;
        });
  const processLogs: IProcessLogs = {
    stderr: [],
    stdout: [],
  };
  const serverPort: number = await findAvailablePort();
  const serverProcess: DevelopmentServerProcess = startDevelopmentServer(serverPort, processLogs);
  let browser: Browser | null = null;

  try {
    await mkdir(recordingsRootPath, { recursive: true });
    await waitForServer(serverPort, serverProcess, processLogs);

    browser = await chromium.launch({ headless: true });

    for (const scenario of scenarios) {
      await recordScenario(browser, serverPort, scenario);
    }
  } finally {
    if (browser !== null) {
      await browser.close();
    }

    await stopDevelopmentServer(serverProcess);
  }
}

async function recordScenario(
  browser: Browser,
  serverPort: number,
  scenario: IMarketingRecordingScenario,
): Promise<void> {
  const context: BrowserContext = await browser.newContext({
    colorScheme: "dark",
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    locale: "en-US",
    reducedMotion: "no-preference",
    timezoneId: "UTC",
    viewport: scenario.viewport,
  });

  try {
    const page: Page = await context.newPage();
    const scenarioUrl: string = `http://127.0.0.1:${serverPort}${capturePathname}?scenario=${scenario.id}`;

    page.on("console", (message) => {
      if (message.type() === "error") {
        console.error(`[${scenario.id}] console error: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      console.error(`[${scenario.id}] page error: ${error.message}`);
    });

    console.log(`Recording ${scenario.id}...`);
    await page.goto(scenarioUrl, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      return window.__DEVHOST_MARKETING_CAPTURE__?.isReady() === true;
    });
    await page.getByTestId("MarketingCapturePage").waitFor({ state: "visible" });

    await startCapture(page);
    await runScenario(page, scenario.id);
    await page.waitForTimeout(700);

    const recordingJson: string = await stopCapture(page);
    const recordingFilePath: string = path.join(recordingsRootPath, scenario.recordingFileName);

    await Bun.write(recordingFilePath, `${recordingJson}\n`);
    console.log(`Wrote ${recordingFilePath}`);
  } finally {
    await context.close();
  }
}

async function runScenario(page: Page, scenarioId: MarketingRecordingScenarioId): Promise<void> {
  switch (scenarioId) {
    case "annotation": {
      await runAnnotationScenario(page);
      return;
    }
    case "overlay": {
      await runOverlayScenario(page);
      return;
    }
    case "routing-health": {
      await runRoutingHealthScenario(page);
      return;
    }
    case "sessions": {
      await runSessionsScenario(page);
      return;
    }
    case "source-jumps": {
      await runSourceJumpScenario(page);
      return;
    }
  }
}

async function runAnnotationScenario(page: Page): Promise<void> {
  const primaryTarget = page.getByTestId("MarketingCapturePage--annotation-target-primary");
  const secondaryTarget = page.getByTestId("MarketingCapturePage--annotation-target-secondary");

  await page.keyboard.down("Alt");
  await clickLocator(page, primaryTarget);
  await clickLocator(page, secondaryTarget);
  await page.keyboard.up("Alt");

  const commentInput = page.getByTestId("AnnotationComposer--comment");
  const submitButton = page.getByRole("button", { name: "Submit" });

  await typeIntoLocator(
    page,
    commentInput,
    "Pin #1 under the health badge and align #2 with the launch command rail before the next capture.",
  );
  await clickLocator(page, submitButton);
  await page.getByTestId("TerminalSessionTray--tray-root").waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

async function runSourceJumpScenario(page: Page): Promise<void> {
  const sourceCard = page.getByTestId("CaptureSourceCardSurface--source-card");

  await page.keyboard.down("Alt");
  await clickLocator(page, sourceCard, "right");
  await page.keyboard.up("Alt");

  const firstMenuItem = page.getByTestId("ComponentSourceMenu--item").first();

  await firstMenuItem.waitFor({ state: "visible" });
  await clickLocator(page, firstMenuItem);
  await page.getByTestId("TerminalSessionPanel--content").waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
}

async function runSessionsScenario(page: Page): Promise<void> {
  const sourceCard = page.getByTestId("CaptureSourceCardSurface--source-card");

  await page.keyboard.down("Alt");
  await clickLocator(page, sourceCard, "right");
  await page.keyboard.up("Alt");

  const firstMenuItem = page.getByTestId("ComponentSourceMenu--item").first();

  await firstMenuItem.waitFor({ state: "visible" });
  await clickLocator(page, firstMenuItem);
  await page.getByTestId("TerminalSessionPanel--content").waitFor({ state: "visible" });

  const expandedSessionContent = page.getByTestId("TerminalSessionPanel--content");
  const terminalViewport = expandedSessionContent.getByTestId("TerminalSessionPanel--terminal");
  const minimizeButton = page.locator('[data-devhost-instance-testid="TerminalSessionPanel--minimize"]');
  const expandButton = page.getByRole("button", { name: "Expand Neovim preview" });

  await clickLocator(page, terminalViewport);
  await page.keyboard.type(":set relativenumber\r", { delay: 26 });
  await page.waitForTimeout(700);
  await clickLocator(page, minimizeButton);
  await expandButton.waitFor({ state: "visible" });
  await moveCursorToLocator(page, expandButton, 500);
  await clickLocator(page, expandButton);
  await page.getByTestId("TerminalSessionPanel--content").waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

async function runOverlayScenario(page: Page): Promise<void> {
  const servicePanel = page.getByTestId("ServiceStatusPanel");
  const externalToolsPanel = page.getByTestId("ExternalDevtoolsPanel");
  const logMinimap = page.getByTestId("LogMinimap");
  const routeButton = page.getByTestId("MarketingCapturePage--route-live-button");

  await moveCursorToLocator(page, servicePanel, 650);

  if ((await externalToolsPanel.count()) > 0) {
    await moveCursorToLocator(page, externalToolsPanel, 650);
  }

  await moveCursorToLocator(page, logMinimap, 800);
  await page.mouse.wheel(0, 760);
  await page.waitForTimeout(900);
  await moveCursorToLocator(page, routeButton, 500);
  await page.waitForTimeout(700);
}

async function runRoutingHealthScenario(page: Page): Promise<void> {
  const routeStatusCard = page.getByTestId("MarketingCapturePage--route-status-card");
  const routeButton = page.getByTestId("MarketingCapturePage--route-live-button");
  const servicePanel = page.getByTestId("ServiceStatusPanel");

  await moveCursorToLocator(page, routeStatusCard, 700);
  await page.waitForTimeout(900);
  await page.waitForFunction(() => {
    const routeButtonElement: Element | null = document.querySelector(
      '[data-testid="MarketingCapturePage--route-live-button"]',
    );

    return routeButtonElement instanceof HTMLButtonElement && routeButtonElement.disabled === false;
  });
  await clickLocator(page, routeButton);
  await moveCursorToLocator(page, servicePanel, 700);
  await page.waitForTimeout(900);
}

async function clickLocator(page: Page, locator: Locator, button: MouseButton = "left"): Promise<void> {
  const target = await readLocatorCenter(locator);

  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.waitForTimeout(180);
  await page.mouse.click(target.x, target.y, { button });
  await page.waitForTimeout(220);
}

async function moveCursorToLocator(page: Page, locator: Locator, pauseMs: number): Promise<void> {
  const target = await readLocatorCenter(locator);

  await page.mouse.move(target.x, target.y, { steps: 18 });
  await page.waitForTimeout(pauseMs);
}

async function readLocatorCenter(locator: Locator): Promise<IPoint> {
  await locator.waitFor({ state: "visible" });

  const boundingBox = await locator.boundingBox();

  if (boundingBox === null) {
    throw new Error("Could not read the bounding box for a required capture target.");
  }

  return {
    x: boundingBox.x + boundingBox.width / 2,
    y: boundingBox.y + boundingBox.height / 2,
  };
}

async function startCapture(page: Page): Promise<void> {
  const didStart: boolean = await page.evaluate(() => {
    return window.__DEVHOST_MARKETING_CAPTURE__?.startRecording() ?? false;
  });

  if (!didStart) {
    throw new Error("Failed to start the rrweb marketing capture.");
  }

  await page.waitForTimeout(250);
}

async function stopCapture(page: Page): Promise<string> {
  const recordingJson: string | null = await page.evaluate(() => {
    const captureApi = window.__DEVHOST_MARKETING_CAPTURE__;

    if (captureApi === undefined) {
      return null;
    }

    const recording = captureApi.stopRecording();

    return recording === null ? null : JSON.stringify(recording, null, 2);
  });

  if (recordingJson === null) {
    throw new Error("Failed to stop the rrweb marketing capture.");
  }

  return recordingJson;
}

function startDevelopmentServer(serverPort: number, processLogs: IProcessLogs): DevelopmentServerProcess {
  const serverProcess = spawn(process.execPath, ["src/server.ts"], {
    cwd: workspaceRootPath,
    env: {
      ...process.env,
      DEVHOST_BIND_HOST: "127.0.0.1",
      DEVHOST_HOST: "127.0.0.1",
      NODE_ENV: "development",
      PORT: String(serverPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (serverProcess.stdout === null || serverProcess.stderr === null) {
    throw new Error("The development server did not expose stdout/stderr pipes for log capture.");
  }

  serverProcess.stdout.on("data", (chunk: ReadableChunk) => {
    processLogs.stdout.push(chunk.toString());
  });
  serverProcess.stderr.on("data", (chunk: ReadableChunk) => {
    processLogs.stderr.push(chunk.toString());
  });

  return serverProcess;
}

async function stopDevelopmentServer(serverProcess: DevelopmentServerProcess): Promise<void> {
  if (serverProcess.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    const forceKillTimer = setTimeout((): void => {
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
    }, 2_000);

    serverProcess.once("close", () => {
      clearTimeout(forceKillTimer);
      resolve();
    });
    serverProcess.kill("SIGTERM");
  });
}

async function waitForServer(
  serverPort: number,
  serverProcess: DevelopmentServerProcess,
  processLogs: IProcessLogs,
): Promise<void> {
  const serverUrl: string = `http://127.0.0.1:${serverPort}${capturePathname}`;
  const deadlineMs: number = Date.now() + serverStartupTimeoutMs;

  while (Date.now() < deadlineMs) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`The development server exited early.\n\n${formatProcessLogs(processLogs)}`);
    }

    try {
      const response = await fetch(serverUrl);

      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }

    await Bun.sleep(150);
  }

  throw new Error(`Timed out waiting for the development server to start.\n\n${formatProcessLogs(processLogs)}`);
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probeServer = createServer();

    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const address = probeServer.address();

      if (address === null || typeof address === "string") {
        probeServer.close();
        reject(new Error("Failed to allocate a local TCP port for the marketing recorder."));
        return;
      }

      const resolvedPort: number = address.port;

      probeServer.close((error?: Error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve(resolvedPort);
      });
    });
  });
}

function formatProcessLogs(processLogs: IProcessLogs): string {
  const stdoutText: string = processLogs.stdout.join("").trim();
  const stderrText: string = processLogs.stderr.join("").trim();

  return [
    stdoutText.length > 0 ? `stdout:\n${stdoutText}` : "stdout:\n<empty>",
    stderrText.length > 0 ? `stderr:\n${stderrText}` : "stderr:\n<empty>",
  ].join("\n\n");
}

function printUsage(): void {
  const scenarioList: string = marketingRecordingScenarios.map((scenario) => `- ${scenario.id}`).join("\n");

  console.log(`Usage: bun run record:marketing [scenario-id ...]\n\nAvailable scenarios:\n${scenarioList}`);
}

function readRequestedScenarioIds(argumentsList: readonly string[]): readonly MarketingRecordingScenarioId[] {
  const requestedScenarioIds: MarketingRecordingScenarioId[] = [];

  for (const argument of argumentsList) {
    if (argument === "--help" || argument === "-h") {
      printUsage();
      process.exit(0);
    }

    const scenario: IMarketingRecordingScenario | null = readMarketingRecordingScenario(argument);

    if (scenario === null) {
      throw new Error(`Unknown marketing recording scenario: ${argument}`);
    }

    requestedScenarioIds.push(scenario.id);
  }

  return requestedScenarioIds;
}

async function typeIntoLocator(page: Page, locator: Locator, text: string): Promise<void> {
  await clickLocator(page, locator);
  await page.keyboard.type(text, { delay: 28 });
  await page.waitForTimeout(250);
}
