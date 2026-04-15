import assert from "node:assert";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { IAnnotationSubmitDetail } from "../../devtools/features/annotationComposer/types";
import type { StartTerminalSessionRequest } from "../../devtools/features/terminalSessions/types";
import {
  ANNOTATION_QUEUES_PATH,
  ANNOTATION_QUEUES_WEBSOCKET_PATH,
  HEALTH_WEBSOCKET_PATH,
  INJECTED_SCRIPT_PATH,
  LOGS_WEBSOCKET_PATH,
  TERMINAL_SESSION_START_PATH,
  TERMINAL_SESSION_WEBSOCKET_PATH,
} from "../../devtools/shared/constants";
import type { HealthResponse } from "../../devtools/shared/types";
import type { ILaunchedTerminalSession } from "../../agents/launchTerminalSession";
import { startDevtoolsControlServer } from "../startDevtoolsControlServer";
import type { IDevhostLogger } from "../../utils/createLogger";
import type {
  TestPromiseVoid,
  TestResizeEvent,
  TestSessionStartResponse,
  TestTerminalDataHandler,
  TestTerminalExitResolver,
  TestTerminalStub,
} from "../../utils/__tests__/testTypes";

const stopFunctions: Array<TestPromiseVoid> = [];
const websockets: WebSocket[] = [];

afterEach(async () => {
  for (const websocket of websockets.splice(0)) {
    websocket.close();
  }

  await Promise.all(
    stopFunctions.splice(0).map(async (stop: TestPromiseVoid): Promise<void> => {
      await stop();
    }),
  );
});

describe("startDevtoolsControlServer", () => {
  test("streams managed service health payloads over websocket", async () => {
    let healthResponse: HealthResponse = {
      services: [
        {
          name: "api",
          status: true,
        },
      ],
    };
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "top-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return healthResponse;
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
    });

    stopFunctions.push(controlServer.stop);

    const websocket = new WebSocket(`ws://127.0.0.1:${controlServer.port}${HEALTH_WEBSOCKET_PATH}`);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify(healthResponse));

    const nextMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    healthResponse = {
      services: [
        {
          name: "api",
          status: false,
        },
      ],
    };

    await controlServer.publishHealthResponse();

    await expect(nextMessagePromise).resolves.toBe(JSON.stringify(healthResponse));
  });

  test("replays retained logs and streams new log entries over websocket", async () => {
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
    });

    stopFunctions.push(controlServer.stop);

    controlServer.publishLogEntry("api", "stdout", "[api] ready");

    const websocket = new WebSocket(`ws://127.0.0.1:${controlServer.port}${LOGS_WEBSOCKET_PATH}`);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(
      JSON.stringify({
        entries: [
          {
            id: 1,
            line: "[api] ready",
            serviceName: "api",
            stream: "stdout",
          },
        ],
        type: "snapshot",
      }),
    );

    const nextMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    controlServer.publishLogEntry("api", "stderr", "[api] failed");

    await expect(nextMessagePromise).resolves.toBe(
      JSON.stringify({
        entry: {
          id: 2,
          line: "[api] failed",
          serviceName: "api",
          stream: "stderr",
        },
        type: "entry",
      }),
    );
  });

  test("starts a terminal session for submitted annotations", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
      startTerminalSession: terminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const annotationRequest: StartTerminalSessionRequest = {
      annotation: createAnnotationDetail(),
      kind: "agent",
    };
    const controlToken: string = await readControlToken(controlServer.port);
    const startResponse: Response = await fetch(
      `http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`,
      {
        body: JSON.stringify(annotationRequest),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );

    expect(startResponse.status).toBe(200);
    expect(terminalStub.startedRequests).toEqual([annotationRequest]);

    const startResponseBody: unknown = await startResponse.json();

    assert(isSessionStartResponse(startResponseBody));

    const websocket = createSessionWebSocket(controlServer.port, startResponseBody.sessionId, controlToken);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify({ data: "", type: "snapshot" }));

    const outputMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    terminalStub.emit("[pi] hello\n");

    await expect(outputMessagePromise).resolves.toBe(JSON.stringify({ data: "[pi] hello\n", type: "output" }));

    const closePromise: Promise<void> = waitForWebSocketClose(websocket);

    websocket.send(JSON.stringify({ data: "fix it\n", type: "input" }));
    websocket.send(JSON.stringify({ cols: 100, rows: 30, type: "resize" }));
    websocket.send(JSON.stringify({ type: "close" }));

    await closePromise;

    expect(terminalStub.writes).toEqual(["fix it\n"]);
    expect(terminalStub.resizes).toEqual([
      {
        cols: 100,
        rows: 30,
      },
    ]);
    expect(terminalStub.closeCount).toBe(1);
  });

  test("rejects malformed terminal websocket messages without crashing the session", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
      startTerminalSession: terminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const controlToken: string = await readControlToken(controlServer.port);
    const startResponse: Response = await fetch(
      `http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`,
      {
        body: JSON.stringify({
          annotation: createAnnotationDetail(),
          kind: "agent",
        }),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );
    const startResponseBody: unknown = await startResponse.json();

    expect(startResponse.status).toBe(200);
    assert(isSessionStartResponse(startResponseBody));

    const websocket = createSessionWebSocket(controlServer.port, startResponseBody.sessionId, controlToken);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify({ data: "", type: "snapshot" }));

    const errorMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    websocket.send("{bad json");

    await expect(errorMessagePromise).resolves.toBe(
      JSON.stringify({ message: "Invalid terminal message.", type: "error" }),
    );
    expect(websocket.readyState).toBe(WebSocket.OPEN);
  });

  test("starts a terminal session for editor navigation", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "neovim",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
      startTerminalSession: terminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const componentSourceRequest: StartTerminalSessionRequest = {
      componentName: "SaveButton",
      kind: "editor",
      launcher: "neovim",
      source: {
        columnNumber: 8,
        fileName: "src/components/SaveButton.tsx",
        lineNumber: 42,
      },
      sourceLabel: "src/components/SaveButton.tsx:42:8",
    };
    const controlToken: string = await readControlToken(controlServer.port);
    const startResponse: Response = await fetch(
      `http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`,
      {
        body: JSON.stringify(componentSourceRequest),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );

    expect(startResponse.status).toBe(200);
    expect(terminalStub.startedRequests).toEqual([componentSourceRequest]);
  });

  test("lists active terminal sessions for reconnecting devtools clients", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "neovim",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
      startTerminalSession: terminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const controlToken: string = await readControlToken(controlServer.port);
    const annotationRequest: StartTerminalSessionRequest = {
      annotation: createAnnotationDetail(),
      kind: "agent",
    };
    const startResponse: Response = await fetch(
      `http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`,
      {
        body: JSON.stringify(annotationRequest),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );
    const startResponseBody: unknown = await startResponse.json();

    expect(startResponse.status).toBe(200);
    assert(isSessionStartResponse(startResponseBody));

    const listResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      headers: {
        "x-devhost-control-token": controlToken,
      },
      method: "GET",
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({
      sessions: [
        {
          request: annotationRequest,
          sessionId: startResponseBody.sessionId,
        },
      ],
    });
  });

  test("queues targeted annotation submissions and exposes queue snapshots over http and websocket", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const stateDirectoryPath: string = createTestStateDirectory();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startTerminalSession: terminalStub.start,
      stateDirectoryPath,
    });

    stopFunctions.push(controlServer.stop);

    const controlToken: string = await readControlToken(controlServer.port);
    const firstAnnotationRequest: StartTerminalSessionRequest = {
      annotation: createAnnotationDetail(),
      kind: "agent",
    };
    const firstResponse = await fetch(`http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      body: JSON.stringify(firstAnnotationRequest),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });
    const firstResponseBody: unknown = await firstResponse.json();

    assert(isSessionStartResponse(firstResponseBody));

    const queueWebSocket = createAnnotationQueueWebSocket(controlServer.port, controlToken);

    websockets.push(queueWebSocket);

    const initialQueueMessage = JSON.parse(await waitForWebSocketMessage(queueWebSocket));

    expect(initialQueueMessage).toEqual({
      queues: [
        {
          activeSessionId: firstResponseBody.sessionId,
          entries: [expect.objectContaining({ state: "active" })],
          pauseReason: null,
          queueId: expect.any(String),
          status: "launching",
        },
      ],
      type: "snapshot",
    });

    const workingQueueMessagePromise: Promise<string> = waitForWebSocketMessage(queueWebSocket);

    terminalStub.emit("\u001b]1337;SetAgentStatus=working\u0007");

    expect(JSON.parse(await workingQueueMessagePromise)).toEqual({
      queues: [
        {
          activeSessionId: firstResponseBody.sessionId,
          entries: [expect.objectContaining({ state: "active" })],
          pauseReason: null,
          queueId: expect.any(String),
          status: "working",
        },
      ],
      type: "snapshot",
    });

    const secondAnnotationRequest: StartTerminalSessionRequest = {
      annotation: {
        ...createAnnotationDetail(),
        comment: "Queue the follow-up annotation.",
      },
      kind: "agent",
      targetSessionId: firstResponseBody.sessionId,
    };
    const queueUpdatePromise: Promise<string> = waitForWebSocketMessage(queueWebSocket);
    const secondResponse = await fetch(`http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      body: JSON.stringify(secondAnnotationRequest),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });
    const secondResponseBody: unknown = await secondResponse.json();

    assert(isSessionStartResponse(secondResponseBody));
    expect(secondResponseBody.sessionId).toBe(firstResponseBody.sessionId);
    expect(terminalStub.startedRequests).toEqual([firstAnnotationRequest]);
    expect(terminalStub.writes).toEqual([]);

    const listQueuesResponse = await fetch(`http://127.0.0.1:${controlServer.port}${ANNOTATION_QUEUES_PATH}`, {
      headers: {
        "x-devhost-control-token": controlToken,
      },
      method: "GET",
    });

    const listQueuesBody = await listQueuesResponse.json();

    expect(listQueuesBody).toEqual({
      queues: [
        {
          activeSessionId: firstResponseBody.sessionId,
          entries: [
            expect.objectContaining({ annotation: firstAnnotationRequest.annotation, state: "active" }),
            expect.objectContaining({ annotation: secondAnnotationRequest.annotation, state: "queued" }),
          ],
          pauseReason: null,
          queueId: expect.any(String),
          status: "working",
        },
      ],
    });

    expect(JSON.parse(await queueUpdatePromise)).toEqual({
      queues: [
        {
          activeSessionId: firstResponseBody.sessionId,
          entries: [
            expect.objectContaining({ annotation: firstAnnotationRequest.annotation, state: "active" }),
            expect.objectContaining({ annotation: secondAnnotationRequest.annotation, state: "queued" }),
          ],
          pauseReason: null,
          queueId: expect.any(String),
          status: "working",
        },
      ],
      type: "snapshot",
    });

    const queuedEntryId = listQueuesBody.queues[0].entries[1].entryId;
    const patchResponse = await fetch(
      `http://127.0.0.1:${controlServer.port}${ANNOTATION_QUEUES_PATH}/${queuedEntryId}`,
      {
        body: JSON.stringify({ comment: "Updated queued annotation" }),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "PATCH",
      },
    );

    expect(patchResponse.status).toBe(200);

    terminalStub.emit("\u001b]1337;SetAgentStatus=finished\u0007");
    await Bun.sleep(0);

    expect(terminalStub.writes).toEqual([
      expect.stringMatching(
        /^Please read the annotation details from .*prompt\.txt and address the requested change\.\r$/,
      ),
    ]);
  });

  test("resumes paused queues through the resume endpoint", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startTerminalSession: terminalStub.start,
      stateDirectoryPath: createTestStateDirectory(),
    });

    stopFunctions.push(controlServer.stop);

    const controlToken: string = await readControlToken(controlServer.port);
    const startResponse = await fetch(`http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      body: JSON.stringify({
        annotation: createAnnotationDetail(),
        kind: "agent",
      }),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });
    const startResponseBody: unknown = await startResponse.json();

    assert(isSessionStartResponse(startResponseBody));

    const websocket = createSessionWebSocket(controlServer.port, startResponseBody.sessionId, controlToken);

    websockets.push(websocket);
    await waitForWebSocketMessage(websocket);
    websocket.send(JSON.stringify({ type: "close" }));
    await waitForWebSocketClose(websocket);

    const listQueuesResponse = await fetch(`http://127.0.0.1:${controlServer.port}${ANNOTATION_QUEUES_PATH}`, {
      headers: {
        "x-devhost-control-token": controlToken,
      },
      method: "GET",
    });
    const listQueuesBody = await listQueuesResponse.json();
    const pausedQueueId: string = listQueuesBody.queues[0].queueId;

    const resumeResponse = await fetch(
      `http://127.0.0.1:${controlServer.port}${ANNOTATION_QUEUES_PATH}/${pausedQueueId}/resume`,
      {
        headers: {
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );

    expect(resumeResponse.status).toBe(200);
    await expect(resumeResponse.json()).resolves.toEqual({
      sessionId: expect.any(String),
      success: true,
    });
    expect(terminalStub.startedRequests).toHaveLength(2);
  });

  test("reloads persisted queue state across control-server restarts", async () => {
    const firstTerminalStub: TestTerminalStub = createTerminalStub();
    const stateDirectoryPath: string = createTestStateDirectory();
    const firstControlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startTerminalSession: firstTerminalStub.start,
      stateDirectoryPath,
    });

    const controlToken: string = await readControlToken(firstControlServer.port);
    const firstResponse = await fetch(`http://127.0.0.1:${firstControlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      body: JSON.stringify({
        annotation: createAnnotationDetail(),
        kind: "agent",
      }),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });
    const firstResponseBody: unknown = await firstResponse.json();

    assert(isSessionStartResponse(firstResponseBody));
    firstTerminalStub.emit("\u001b]1337;SetAgentStatus=working\u0007");
    await fetch(`http://127.0.0.1:${firstControlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      body: JSON.stringify({
        annotation: {
          ...createAnnotationDetail(),
          comment: "Queue the follow-up annotation.",
        },
        kind: "agent",
        targetSessionId: firstResponseBody.sessionId,
      }),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });

    await firstControlServer.stop();

    const secondTerminalStub: TestTerminalStub = createTerminalStub();
    const secondControlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startTerminalSession: secondTerminalStub.start,
      stateDirectoryPath,
    });

    stopFunctions.push(secondControlServer.stop);

    expect(secondTerminalStub.startedRequests).toEqual([
      {
        annotation: createAnnotationDetail(),
        kind: "agent",
      },
    ]);

    const secondControlToken: string = await readControlToken(secondControlServer.port);
    const listQueuesResponse = await fetch(`http://127.0.0.1:${secondControlServer.port}${ANNOTATION_QUEUES_PATH}`, {
      headers: {
        "x-devhost-control-token": secondControlToken,
      },
      method: "GET",
    });

    await expect(listQueuesResponse.json()).resolves.toEqual({
      queues: [
        {
          activeSessionId: expect.any(String),
          entries: [
            expect.objectContaining({ annotation: createAnnotationDetail(), state: "active" }),
            expect.objectContaining({
              annotation: expect.objectContaining({ comment: "Queue the follow-up annotation." }),
              state: "queued",
            }),
          ],
          pauseReason: null,
          queueId: expect.any(String),
          status: "launching",
        },
      ],
    });
  });

  test("keeps the terminal websocket open after the process exits until the client closes it", async () => {
    const terminalStub: TestTerminalStub = createTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      agentDisplayName: "Pi",
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      logger: createTestLogger(),
      manifestPath: "/tmp/project/devhost.toml",
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      stateDirectoryPath: createTestStateDirectory(),
      startTerminalSession: terminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const controlToken: string = await readControlToken(controlServer.port);
    const startResponse: Response = await fetch(
      `http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`,
      {
        body: JSON.stringify({
          annotation: createAnnotationDetail(),
          kind: "agent",
        }),
        headers: {
          "content-type": "application/json",
          "x-devhost-control-token": controlToken,
        },
        method: "POST",
      },
    );
    const startResponseBody: unknown = await startResponse.json();

    expect(startResponse.status).toBe(200);
    assert(isSessionStartResponse(startResponseBody));

    const websocket = createSessionWebSocket(controlServer.port, startResponseBody.sessionId, controlToken);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify({ data: "", type: "snapshot" }));

    const exitMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    terminalStub.exitWith(0, null);

    await expect(exitMessagePromise).resolves.toBe(JSON.stringify({ exitCode: 0, signalCode: null, type: "exit" }));

    websocket.send(JSON.stringify({ data: "ignored after exit\n", type: "input" }));
    websocket.send(JSON.stringify({ cols: 120, rows: 40, type: "resize" }));

    await Bun.sleep(0);

    expect(websocket.readyState).toBe(WebSocket.OPEN);
    expect(terminalStub.closeCount).toBe(0);
    expect(terminalStub.resizes).toEqual([]);
    expect(terminalStub.writes).toEqual([]);

    const closePromise: Promise<void> = waitForWebSocketClose(websocket);

    websocket.send(JSON.stringify({ type: "close" }));

    await closePromise;

    const listResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${TERMINAL_SESSION_START_PATH}`, {
      headers: {
        "x-devhost-control-token": controlToken,
      },
      method: "GET",
    });

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toEqual({ sessions: [] });
    expect(terminalStub.closeCount).toBe(1);
  });
});

function createAnnotationDetail(): IAnnotationSubmitDetail {
  return {
    comment: "Replace #1 with the new CTA.",
    markers: [
      {
        accessibility: 'role="button", focusable',
        boundingBox: {
          height: 24,
          width: 120,
          x: 16,
          y: 40,
        },
        computedStyles: "color: rgb(17, 24, 39)",
        computedStylesObj: {
          color: "rgb(17, 24, 39)",
        },
        cssClasses: "cta-button",
        element: 'button "Save changes"',
        elementPath: ".toolbar > button",
        fullPath: "body > div.toolbar > button",
        isFixed: false,
        markerNumber: 1,
        nearbyElements: 'a "Docs"',
        nearbyText: "Save your work",
        selectedText: "Save changes",
        sourceLocation: {
          columnNumber: 8,
          componentName: "SaveButton",
          fileName: "src/components/SaveButton.tsx",
          lineNumber: 42,
        },
      },
    ],
    stackName: "hello-stack",
    submittedAt: 1_743_362_700_000,
    title: "Example page",
    url: "https://example.test/products",
  };
}

function createTerminalStub(): TestTerminalStub {
  const encoder: TextEncoder = new TextEncoder();
  const resizes: Array<TestResizeEvent> = [];
  const startedRequests: StartTerminalSessionRequest[] = [];
  const writes: string[] = [];
  let closeCount: number = 0;
  let dataHandler: TestTerminalDataHandler | null = null;
  let exitCode: number | null = null;
  let resolveExit: TestTerminalExitResolver | null = null;
  let signalCode: string | null = null;
  const exitPromise: Promise<number> = new Promise<number>((resolve): void => {
    resolveExit = resolve;
  });

  return {
    get closeCount(): number {
      return closeCount;
    },
    emit: (text: string): void => {
      dataHandler?.(encoder.encode(text));
    },
    exitWith: (nextExitCode: number, nextSignalCode: string | null): void => {
      exitCode = nextExitCode;
      signalCode = nextSignalCode;
      resolveExit?.(nextExitCode);
    },
    resizes,
    start: (request: StartTerminalSessionRequest, onData: TestTerminalDataHandler): ILaunchedTerminalSession => {
      startedRequests.push(request);
      dataHandler = onData;

      return {
        childProcess: {
          get exitCode(): number | null {
            return exitCode;
          },
          exited: exitPromise,
          killed: false,
          get signalCode(): string | null {
            return signalCode;
          },
        } as Bun.Subprocess,
        cleanup: (): void => {},
        close: (): void => {
          closeCount += 1;
        },
        resize: (cols: number, rows: number): void => {
          resizes.push({ cols, rows });
        },
        write: (data: string): void => {
          writes.push(data);
        },
      };
    },
    startedRequests,
    writes,
  };
}

async function readControlToken(port: number): Promise<string> {
  const injectedScriptResponse: Response = await fetch(`http://127.0.0.1:${port}${INJECTED_SCRIPT_PATH}`);

  return extractControlToken(await injectedScriptResponse.text());
}

function createSessionWebSocket(port: number, sessionId: string, controlToken: string): WebSocket {
  const websocketUrl: URL = new URL(`ws://127.0.0.1:${port}${TERMINAL_SESSION_WEBSOCKET_PATH}`);

  websocketUrl.searchParams.set("sessionId", sessionId);
  websocketUrl.searchParams.set("token", controlToken);

  return new WebSocket(websocketUrl);
}

function createAnnotationQueueWebSocket(port: number, controlToken: string): WebSocket {
  const websocketUrl: URL = new URL(`ws://127.0.0.1:${port}${ANNOTATION_QUEUES_WEBSOCKET_PATH}`);

  websocketUrl.searchParams.set("token", controlToken);

  return new WebSocket(websocketUrl);
}

function extractControlToken(injectedScript: string): string {
  const tokenMatch: RegExpMatchArray | null = injectedScript.match(/"controlToken":"([^"]+)"/);

  assert(tokenMatch !== null, "Expected the injected script to include a control token.");
  assert(tokenMatch[1] !== undefined, "Expected the injected script to include a capture group for the control token.");

  return tokenMatch[1];
}

function isSessionStartResponse(value: unknown): value is TestSessionStartResponse {
  const sessionId: unknown = Reflect.get(Object(value), "sessionId");

  return typeof sessionId === "string" && sessionId.length > 0;
}

function waitForWebSocketClose(websocket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleClose = (): void => {
      cleanup();
      resolve();
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("WebSocket error."));
    };

    const cleanup = (): void => {
      websocket.removeEventListener("close", handleClose);
      websocket.removeEventListener("error", handleError);
    };

    websocket.addEventListener("close", handleClose);
    websocket.addEventListener("error", handleError);
  });
}

function waitForWebSocketMessage(websocket: WebSocket): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handleClose = (): void => {
      cleanup();
      reject(new Error("WebSocket closed before receiving a message."));
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error("WebSocket error."));
    };
    const handleMessage = (event: MessageEvent): void => {
      cleanup();

      try {
        assert(typeof event.data === "string", "Expected a text websocket message.");
        resolve(event.data);
      } catch (error) {
        reject(error);
      }
    };

    const cleanup = (): void => {
      websocket.removeEventListener("close", handleClose);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("message", handleMessage);
    };

    websocket.addEventListener("close", handleClose);
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("message", handleMessage);
  });
}

function createTestLogger(): IDevhostLogger {
  return {
    error(): void {},
    info(): void {},
    withLabel(): IDevhostLogger {
      return createTestLogger();
    },
  };
}

function createTestStateDirectory(): string {
  const stateDirectoryPath: string = join(tmpdir(), `devhost-control-server-test-${crypto.randomUUID()}`);

  rmSync(stateDirectoryPath, { force: true, recursive: true });
  mkdirSync(stateDirectoryPath, { recursive: true });

  return stateDirectoryPath;
}
