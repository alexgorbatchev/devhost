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
  readRequestedMarketingRecordingScenarioIds,
  type IMarketingRecordingScenario,
  type IMarketingRecordingViewport,
  type MarketingRecordingScenarioId,
} from "../src/recordings/marketingRecordingScenarios";

interface IProcessLogs {
  stderr: string[];
  stdout: string[];
}

interface IPoint {
  x: number;
  y: number;
}

interface ILocatorClickTarget {
  x: number;
  y: number;
}

interface ICursorMotionOptions {
  speedMultiplier?: number;
}

type DevelopmentServerProcess = ReturnType<typeof spawn>;
type MouseButton = "left" | "right";
type ReadableChunk = string | Uint8Array;

const afterLeftClickPauseMs: number = 320;
const afterRightClickPauseMs: number = 420;
const annotationHighlightPauseMs: number = 1_000;
const annotationHighlightWiggleOffsetPx: number = 6;
const annotationTerminalPreviewPauseMs: number = 5_000;
const beforeClickPauseMs: number = 140;
const browserDocumentRequestHeaders: HeadersInit = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
};
const capturePathnames: readonly string[] = ["/devhost/__capture__/", "/__capture__/"];
const clickHoldDurationMs: number = 90;
const cursorFrameIntervalMs: number = 18;
const cursorPathBaseDurationMs: number = 220;
const cursorPathDurationPerPixelMs: number = 1.05;
const cursorPositionsByPage = new WeakMap<Page, IPoint>();
const cursorWigglePauseMs: number = 90;
const cursorWiggleShowcaseDurationMs: number = 1_000;
const maximumCursorPathDurationMs: number = 1_250;
const minimumCursorPathDurationMs: number = 320;
const serverStartupTimeoutMs: number = 30_000;
const sourceMenuPauseMs: number = 1_000;
const sourceCardContextMenuTarget: ILocatorClickTarget = { x: 0.18, y: 0.72 };
const terminalScrollDistancePx: number = 1_000;
const terminalScrollDurationMs: number = 2_000;
const viewportEdgeInsetPx: number = 4;
const workspaceRootPath: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const recordingsRootPath: string = path.join(workspaceRootPath, "public", "recordings", "marketing");
const xtermStylesheetPath: string = path.join(workspaceRootPath, "public", "__devhost__", "xterm.css");

await main();

async function main(): Promise<void> {
  const requestedScenarioIds: readonly MarketingRecordingScenarioId[] = readRequestedMarketingRecordingScenarioIds(
    Bun.argv.slice(2),
  );
  const scenarios: readonly IMarketingRecordingScenario[] =
    requestedScenarioIds.length === 0
      ? marketingRecordingScenarios
      : requestedScenarioIds.map((scenarioId: MarketingRecordingScenarioId): IMarketingRecordingScenario => {
          const scenario: IMarketingRecordingScenario | null = readMarketingRecordingScenario(scenarioId);

          if (scenario === null) {
            throw new Error(`Unknown marketing recording scenario: ${scenarioId}`);
          }

          return scenario;
        });
  const processLogs: IProcessLogs = { stderr: [], stdout: [] };
  const serverPort: number = await findAvailablePort();
  await buildPreviewSite(processLogs);
  const serverProcess: DevelopmentServerProcess = startPreviewServer(serverPort, processLogs);
  let browser: Browser | null = null;

  try {
    await mkdir(recordingsRootPath, { recursive: true });
    const capturePathname: string = await waitForServer(serverPort, serverProcess, processLogs);

    browser = await chromium.launch({ headless: true });

    for (const scenario of scenarios) {
      await recordScenario(browser, serverPort, capturePathname, scenario);
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
  capturePathname: string,
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

    await page.route(`http://127.0.0.1:${serverPort}/__devhost__/xterm.css`, async (route) => {
      await route.fulfill({ contentType: "text/css; charset=utf-8", path: xtermStylesheetPath, status: 200 });
    });

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
    await page.getByTestId("AppContent").waitFor({ state: "attached" });
    await page.getByTestId("ServiceStatusPanel").waitFor({ state: "visible" });
    await page.getByTestId("AnnotationComposer").waitFor({ state: "attached" });
    await page.getByTestId("AnnotationQueuePanel").waitFor({ state: "visible" });
    await page.getByTestId("TerminalSessionTray--tray-root").waitFor({ state: "visible" });
    await page.waitForTimeout(750);

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
    case "annotation":
      await runAnnotationScenario(page);
      return;
    case "overlay":
      await runOverlayScenario(page);
      return;
    case "routing-health":
      await runRoutingHealthScenario(page);
      return;
    case "sessions":
      await runSessionsScenario(page);
      return;
    case "source-jumps":
      await runSourceJumpScenario(page);
      return;
  }
}

async function runAnnotationScenario(page: Page): Promise<void> {
  const primaryTarget = page.getByTestId("MarketingCapturePage--annotation-target-primary");
  const secondaryTarget = page.getByTestId("MarketingCapturePage--annotation-target-secondary");
  const sourceCard = page.getByTestId("CaptureSourceContent--source-card");

  await moveCursorToLocator(page, primaryTarget, 0);
  await page.keyboard.down("Alt");
  await wiggleCursorAtLocator(page, primaryTarget);
  await page.waitForTimeout(annotationHighlightPauseMs);
  await clickLocator(page, primaryTarget);
  await moveCursorToLocator(page, secondaryTarget, annotationHighlightPauseMs);
  await clickLocator(page, secondaryTarget);
  await page.keyboard.up("Alt");

  const commentInput = page.getByTestId("AnnotationComposer--comment");
  const submitButton = page.getByRole("button", { name: /Run / });

  await typeIntoLocator(
    page,
    commentInput,
    "Pin #1 under the health badge and align #2 with the launch command rail before the next capture.",
  );
  await clickLocator(page, submitButton);

  const sessionTray = page.getByTestId("TerminalSessionTray--tray-root");
  const agentSessionExpandButton = page.getByRole("button", { name: "Expand Agent terminal preview" }).last();

  await sessionTray.waitFor({ state: "visible" });
  await clickLocator(page, agentSessionExpandButton, "left", { x: 0.78, y: 0.78 });

  const terminalPanel = page.getByTestId("TerminalSessionPanel--content");
  const minimizeButton = page.locator('[data-devhost-instance-testid="TerminalSessionPanel--minimize"]');

  await terminalPanel.waitFor({ state: "visible" });
  await page.waitForTimeout(annotationTerminalPreviewPauseMs);
  await moveCursorToLocator(page, minimizeButton, annotationHighlightPauseMs);
  await clickLocator(page, minimizeButton);
  await sessionTray.waitFor({ state: "visible" });
  await page.waitForTimeout(annotationTerminalPreviewPauseMs);

  await moveCursorToLocator(page, sourceCard, 0);
  await wiggleCursorAtLocator(page, sourceCard, cursorWiggleShowcaseDurationMs);
  await page.keyboard.down("Alt");
  await clickLocator(page, sourceCard, "right", sourceCardContextMenuTarget);
  await page.keyboard.up("Alt");

  const firstMenuItem = page.getByTestId("ComponentSourceMenu--item").first();

  await firstMenuItem.waitFor({ state: "visible" });
  await page.waitForTimeout(sourceMenuPauseMs);
  await moveCursorToLocator(page, firstMenuItem, 0);
  await wiggleCursorAtLocator(page, firstMenuItem, cursorWiggleShowcaseDurationMs);
  await clickLocator(page, firstMenuItem);
  const sourceExpandButton = page.getByRole("button", { name: "Expand Neovim preview" }).last();
  const sourceTerminalPanel = page.getByTestId("TerminalSessionPanel--content").last();
  const sourceTerminalViewport = sourceTerminalPanel.getByTestId("TerminalSessionPanel--terminal");
  const sourceMinimizeButton = page.locator('[data-devhost-instance-testid="TerminalSessionPanel--minimize"]').last();

  await sourceExpandButton.waitFor({ state: "visible" });
  await clickLocator(page, sourceExpandButton);
  await sourceTerminalPanel.waitFor({ state: "visible" });
  await moveCursorToLocator(page, sourceTerminalViewport, 0);
  await wiggleCursorAtLocator(page, sourceTerminalViewport, cursorWiggleShowcaseDurationMs);
  await scrollLocatorSlowly(page, sourceTerminalViewport, terminalScrollDistancePx, terminalScrollDurationMs);
  await scrollLocatorSlowly(page, sourceTerminalViewport, -terminalScrollDistancePx, terminalScrollDurationMs);
  await moveCursorToLocator(page, sourceMinimizeButton, annotationHighlightPauseMs);
  await clickLocator(page, sourceMinimizeButton);
  await sessionTray.waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

async function runSourceJumpScenario(page: Page): Promise<void> {
  const sourceCard = page.getByTestId("CaptureSourceContent--source-card");
  const visibleSourceTerminalPanel = page.locator('[data-testid="TerminalSessionPanel--content"]:visible').last();

  await page.keyboard.down("Alt");
  await clickLocator(page, sourceCard, "right", sourceCardContextMenuTarget);
  await page.keyboard.up("Alt");

  const firstMenuItem = page.getByTestId("ComponentSourceMenu--item").first();
  const sourceExpandButton = page.getByRole("button", { name: "Expand Neovim preview" }).last();

  await firstMenuItem.waitFor({ state: "visible" });
  await clickLocator(page, firstMenuItem);
  await sourceExpandButton.waitFor({ state: "visible" });
  await clickLocator(page, sourceExpandButton);
  await visibleSourceTerminalPanel.waitFor({ state: "visible" });
  await page.waitForTimeout(1_000);
}

async function runSessionsScenario(page: Page): Promise<void> {
  const sourceCard = page.getByTestId("CaptureSourceContent--source-card");
  const visibleExpandedSessionContent = page.locator('[data-testid="TerminalSessionPanel--content"]:visible').last();
  const visibleTerminalViewport = visibleExpandedSessionContent.locator(
    '[data-testid="TerminalSessionPanel--terminal"]',
  );
  const visibleMinimizeButton = page
    .locator('[data-devhost-instance-testid="TerminalSessionPanel--minimize"]:visible')
    .last();

  await page.keyboard.down("Alt");
  await clickLocator(page, sourceCard, "right", sourceCardContextMenuTarget);
  await page.keyboard.up("Alt");

  const firstMenuItem = page.getByTestId("ComponentSourceMenu--item").first();
  const sourceExpandButton = page.getByRole("button", { name: "Expand Neovim preview" }).last();
  const expandButton = page.getByRole("button", { name: "Expand Neovim preview" }).last();

  await firstMenuItem.waitFor({ state: "visible" });
  await clickLocator(page, firstMenuItem);
  await sourceExpandButton.waitFor({ state: "visible" });
  await clickLocator(page, sourceExpandButton);
  await visibleExpandedSessionContent.waitFor({ state: "visible" });

  await clickLocator(page, visibleTerminalViewport);
  await page.keyboard.type(":set relativenumber\r", { delay: 26 });
  await page.waitForTimeout(700);
  await clickLocator(page, visibleMinimizeButton);
  await expandButton.waitFor({ state: "visible" });
  await moveCursorToLocator(page, expandButton, 500);
  await clickLocator(page, expandButton);
  await visibleExpandedSessionContent.waitFor({ state: "visible" });
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

async function clickLocator(
  page: Page,
  locator: Locator,
  button: MouseButton = "left",
  target: ILocatorClickTarget = { x: 0.5, y: 0.5 },
): Promise<void> {
  const targetPoint: IPoint = await readLocatorPoint(locator, target);

  await moveCursorHumanLike(page, targetPoint);
  await page.waitForTimeout(beforeClickPauseMs);
  await page.mouse.down({ button });
  await page.waitForTimeout(clickHoldDurationMs);
  await page.mouse.up({ button });
  await page.waitForTimeout(button === "left" ? afterLeftClickPauseMs : afterRightClickPauseMs);
}

async function moveCursorToLocator(page: Page, locator: Locator, pauseMs: number): Promise<void> {
  const target: IPoint = await readLocatorPoint(locator);

  await moveCursorHumanLike(page, target);
  await page.waitForTimeout(pauseMs);
}

async function wiggleCursorAtLocator(
  page: Page,
  locator: Locator,
  durationMs: number = cursorFrameIntervalMs * 2,
): Promise<void> {
  const target: IPoint = await readLocatorPoint(locator);
  const wiggleTargets: ReadonlyArray<IPoint> = createCursorWiggleTargets(target, durationMs);

  await moveCursorHumanLike(page, target, { speedMultiplier: 1.6 });
  await moveCursorThroughPoints(page, wiggleTargets, { speedMultiplier: 3.8 });
  await moveCursorHumanLike(page, target, { speedMultiplier: 2.4 });
}

async function scrollLocatorSlowly(page: Page, locator: Locator, deltaY: number, durationMs: number): Promise<void> {
  const target: IPoint = await readLocatorPoint(locator);
  const stepCount: number = 20;
  const stepDelayMs: number = Math.max(1, Math.round(durationMs / stepCount));
  const stepDeltaY: number = Math.round(deltaY / stepCount);

  await moveCursorHumanLike(page, target);

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    await page.mouse.wheel(0, stepDeltaY);
    await page.waitForTimeout(stepDelayMs);
  }
}

async function readLocatorPoint(locator: Locator, target: ILocatorClickTarget = { x: 0.5, y: 0.5 }): Promise<IPoint> {
  await locator.waitFor({ state: "visible" });

  const boundingBox = await locator.boundingBox();

  if (boundingBox === null) {
    throw new Error("Could not read the bounding box for a required capture target.");
  }

  return {
    x: boundingBox.x + boundingBox.width * target.x,
    y: boundingBox.y + boundingBox.height * target.y,
  };
}

async function moveCursorHumanLike(page: Page, target: IPoint, options: ICursorMotionOptions = {}): Promise<void> {
  await moveCursorThroughPoints(page, [target], options);
}

async function moveCursorThroughPoints(
  page: Page,
  targets: ReadonlyArray<IPoint>,
  options: ICursorMotionOptions = {},
): Promise<void> {
  const viewport: IMarketingRecordingViewport = readViewport(page);
  let currentPoint: IPoint = cursorPositionsByPage.get(page) ?? createInitialCursorPosition(viewport);

  for (const target of targets) {
    const clampedTarget: IPoint = clampPointToViewport(target, viewport);
    const pathPoints: ReadonlyArray<IPoint> = createCursorPathPoints(currentPoint, clampedTarget, viewport, options);

    for (const point of pathPoints) {
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(cursorFrameIntervalMs);
    }

    currentPoint = clampedTarget;
  }

  cursorPositionsByPage.set(page, currentPoint);
}

function clampNumber(value: number, minimumValue: number, maximumValue: number): number {
  return Math.min(Math.max(value, minimumValue), maximumValue);
}

function clampPointToViewport(point: IPoint, viewport: IMarketingRecordingViewport): IPoint {
  return {
    x: clampNumber(point.x, viewportEdgeInsetPx, viewport.width - viewportEdgeInsetPx),
    y: clampNumber(point.y, viewportEdgeInsetPx, viewport.height - viewportEdgeInsetPx),
  };
}

function createCursorPathPoints(
  start: IPoint,
  end: IPoint,
  viewport: IMarketingRecordingViewport,
  options: ICursorMotionOptions = {},
): ReadonlyArray<IPoint> {
  const distance: number = readPointDistance(start, end);

  if (distance < 1) {
    return [end];
  }

  const speedMultiplier: number = clampNumber(options.speedMultiplier ?? 1, 0.4, 6);
  const durationMs: number = clampNumber(
    ((cursorPathBaseDurationMs + distance * cursorPathDurationPerPixelMs) * readRandomNumber(0.94, 1.08)) /
      speedMultiplier,
    minimumCursorPathDurationMs / speedMultiplier,
    maximumCursorPathDurationMs / speedMultiplier,
  );
  const minimumStepCount: number = distance < 24 ? 4 : 16;
  const stepCount: number = Math.max(minimumStepCount, Math.round(durationMs / cursorFrameIntervalMs));
  const direction: IPoint = readUnitVector(start, end);
  const perpendicular: IPoint = { x: -direction.y, y: direction.x };
  const lineVector: IPoint = { x: end.x - start.x, y: end.y - start.y };
  const primaryArcOffsetPx: number = clampNumber(distance * readRandomNumber(0.12, 0.16), 18, 76) * readRandomSign();
  const secondaryArcOffsetPx: number = primaryArcOffsetPx * readRandomNumber(0.34, 0.5);
  const wobbleAmplitudePx: number = clampNumber(distance * readRandomNumber(0.006, 0.01), 0.6, 3.8);
  const wobbleFrequency: number = readRandomNumber(2.25, 3.1);
  const wobblePhase: number = readRandomNumber(0, Math.PI * 2);
  const controlPointOneProgress: number = readRandomNumber(0.24, 0.33);
  const controlPointTwoProgress: number = readRandomNumber(0.7, 0.8);
  const controlPointOne: IPoint = clampPointToViewport(
    {
      x: start.x + lineVector.x * controlPointOneProgress + perpendicular.x * primaryArcOffsetPx,
      y: start.y + lineVector.y * controlPointOneProgress + perpendicular.y * primaryArcOffsetPx,
    },
    viewport,
  );
  const controlPointTwo: IPoint = clampPointToViewport(
    {
      x: start.x + lineVector.x * controlPointTwoProgress + perpendicular.x * secondaryArcOffsetPx,
      y: start.y + lineVector.y * controlPointTwoProgress + perpendicular.y * secondaryArcOffsetPx,
    },
    viewport,
  );
  const pathPoints: IPoint[] = [];

  for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
    const progress: number = stepIndex / stepCount;
    const easedProgress: number = easeInOutSine(progress);
    const curvePoint: IPoint = readCubicBezierPoint(start, controlPointOne, controlPointTwo, end, easedProgress);
    const wobbleOffsetPx: number =
      Math.sin(Math.PI * progress) * Math.sin(progress * Math.PI * wobbleFrequency + wobblePhase) * wobbleAmplitudePx;

    pathPoints.push(
      clampPointToViewport(
        {
          x: curvePoint.x + perpendicular.x * wobbleOffsetPx,
          y: curvePoint.y + perpendicular.y * wobbleOffsetPx,
        },
        viewport,
      ),
    );
  }

  pathPoints[pathPoints.length - 1] = end;
  return pathPoints;
}

function createCursorWiggleTargets(target: IPoint, durationMs: number): ReadonlyArray<IPoint> {
  const stepCount: number = Math.max(2, Math.floor(durationMs / cursorWigglePauseMs));
  const wiggleTargets: IPoint[] = [];
  let angle: number = readRandomNumber(0, Math.PI * 2);

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    angle += Math.PI * readRandomNumber(0.6, 1.05) * readRandomSign();

    const radius: number = readRandomNumber(
      annotationHighlightWiggleOffsetPx * 0.45,
      annotationHighlightWiggleOffsetPx * 1.2,
    );

    wiggleTargets.push({
      x: target.x + Math.cos(angle) * radius,
      y: target.y + Math.sin(angle) * radius,
    });
  }

  return wiggleTargets;
}

function createInitialCursorPosition(viewport: IMarketingRecordingViewport): IPoint {
  return {
    x: viewport.width * 0.22,
    y: viewport.height * 0.76,
  };
}

function easeInOutSine(progress: number): number {
  return 0.5 - Math.cos(Math.PI * progress) / 2;
}

function readCubicBezierPoint(
  start: IPoint,
  controlPointOne: IPoint,
  controlPointTwo: IPoint,
  end: IPoint,
  progress: number,
): IPoint {
  const inverseProgress: number = 1 - progress;
  const inverseProgressSquared: number = inverseProgress * inverseProgress;
  const progressSquared: number = progress * progress;

  return {
    x:
      inverseProgressSquared * inverseProgress * start.x +
      3 * inverseProgressSquared * progress * controlPointOne.x +
      3 * inverseProgress * progressSquared * controlPointTwo.x +
      progressSquared * progress * end.x,
    y:
      inverseProgressSquared * inverseProgress * start.y +
      3 * inverseProgressSquared * progress * controlPointOne.y +
      3 * inverseProgress * progressSquared * controlPointTwo.y +
      progressSquared * progress * end.y,
  };
}

function readPointDistance(start: IPoint, end: IPoint): number {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function readUnitVector(start: IPoint, end: IPoint): IPoint {
  const distance: number = readPointDistance(start, end);

  if (distance === 0) {
    return { x: 1, y: 0 };
  }

  return {
    x: (end.x - start.x) / distance,
    y: (end.y - start.y) / distance,
  };
}

function readViewport(page: Page): IMarketingRecordingViewport {
  return (
    page.viewportSize() ?? {
      height: 960,
      width: 1440,
    }
  );
}

function readRandomNumber(minimumValue: number, maximumValue: number): number {
  return minimumValue + Math.random() * (maximumValue - minimumValue);
}

function readRandomSign(): number {
  return Math.random() < 0.5 ? -1 : 1;
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

function startPreviewServer(serverPort: number, processLogs: IProcessLogs): DevelopmentServerProcess {
  const serverProcess = spawn("bun", ["x", "astro", "preview", "--host", "127.0.0.1", "--port", String(serverPort)], {
    cwd: workspaceRootPath,
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (serverProcess.stdout === null || serverProcess.stderr === null) {
    throw new Error("The Astro preview server did not expose stdout/stderr pipes for log capture.");
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
): Promise<string> {
  const deadlineMs: number = Date.now() + serverStartupTimeoutMs;

  while (Date.now() < deadlineMs) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`The Astro preview server exited early.\n\n${formatProcessLogs(processLogs)}`);
    }

    for (const capturePathname of capturePathnames) {
      try {
        const response = await fetch(`http://127.0.0.1:${serverPort}${capturePathname}`, {
          headers: browserDocumentRequestHeaders,
        });

        if (response.ok) {
          return capturePathname;
        }
      } catch {
        // Server not ready yet.
      }
    }

    await Bun.sleep(150);
  }

  throw new Error(`Timed out waiting for the Astro preview server to start.\n\n${formatProcessLogs(processLogs)}`);
}

async function buildPreviewSite(processLogs: IProcessLogs): Promise<void> {
  const buildProcess = spawn("bun", ["run", "build"], {
    cwd: workspaceRootPath,
    env: {
      ...process.env,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (buildProcess.stdout === null || buildProcess.stderr === null) {
    throw new Error("The Astro build process did not expose stdout/stderr pipes for log capture.");
  }

  buildProcess.stdout.on("data", (chunk: ReadableChunk) => {
    processLogs.stdout.push(chunk.toString());
  });
  buildProcess.stderr.on("data", (chunk: ReadableChunk) => {
    processLogs.stderr.push(chunk.toString());
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    buildProcess.once("error", reject);
    buildProcess.once("close", resolve);
  });

  if (exitCode !== 0) {
    throw new Error(`The Astro build failed before preview startup.\n\n${formatProcessLogs(processLogs)}`);
  }
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

async function typeIntoLocator(page: Page, locator: Locator, text: string): Promise<void> {
  await clickLocator(page, locator);
  await page.keyboard.type(text, { delay: 28 });
  await page.waitForTimeout(250);
}
