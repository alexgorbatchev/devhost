import { afterEach, describe, expect, test } from "bun:test";

import { PI_SESSION_START_PATH, HEALTH_WEBSOCKET_PATH, INJECTED_SCRIPT_PATH, LOGS_WEBSOCKET_PATH, PI_SESSION_WEBSOCKET_PATH } from "../devtools/shared/constants";
import type { IAnnotationSubmitDetail } from "../devtools/features/annotationComposer/types";
import type { HealthResponse } from "../devtools/shared/types";
import type { ILaunchedPiTerminalSession } from "../launchPiTerminalSession";
import { startDevtoolsControlServer } from "../startDevtoolsControlServer";

const stopFunctions: Array<() => Promise<void>> = [];
const websockets: WebSocket[] = [];

afterEach(async () => {
  for (const websocket of websockets.splice(0)) {
    websocket.close();
  }

  await Promise.all(
    stopFunctions.splice(0).map(async (stop): Promise<void> => {
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
      componentEditor: "vscode",
      devtoolsMinimapPosition: "right",
      devtoolsPosition: "top-left",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return healthResponse;
      },
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
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
      componentEditor: "vscode",
      devtoolsMinimapPosition: "left",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
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

  test("starts a Pi terminal session for submitted annotations", async () => {
    const piTerminalStub = createPiTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      componentEditor: "vscode",
      devtoolsMinimapPosition: "left",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startPiTerminalSession: piTerminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const injectedScriptResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${INJECTED_SCRIPT_PATH}`);
    const controlToken: string = extractControlToken(await injectedScriptResponse.text());
    const startResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${PI_SESSION_START_PATH}`, {
      body: JSON.stringify({
        annotation: createAnnotationDetail(),
      }),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });

    expect(startResponse.status).toBe(200);
    expect(piTerminalStub.startedAnnotations).toEqual([createAnnotationDetail()]);

    const startResponseBody: unknown = await startResponse.json();

    expect(isSessionStartResponse(startResponseBody)).toBe(true);

    const websocketUrl: URL = new URL(`ws://127.0.0.1:${controlServer.port}${PI_SESSION_WEBSOCKET_PATH}`);

    websocketUrl.searchParams.set("sessionId", (startResponseBody as { sessionId: string }).sessionId);
    websocketUrl.searchParams.set("token", controlToken);

    const websocket = new WebSocket(websocketUrl);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify({ data: "", type: "snapshot" }));

    const outputMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    piTerminalStub.emit("[pi] hello\n");

    await expect(outputMessagePromise).resolves.toBe(JSON.stringify({ data: "[pi] hello\n", type: "output" }));

    const closePromise: Promise<void> = waitForWebSocketClose(websocket);

    websocket.send(JSON.stringify({ data: "fix it\n", type: "input" }));
    websocket.send(JSON.stringify({ cols: 100, rows: 30, type: "resize" }));
    websocket.send(JSON.stringify({ type: "close" }));

    await closePromise;

    expect(piTerminalStub.writes).toEqual(["fix it\n"]);
    expect(piTerminalStub.resizes).toEqual([
      {
        cols: 100,
        rows: 30,
      },
    ]);
    expect(piTerminalStub.closeCount).toBe(1);
  });

  test("keeps the Pi terminal websocket open after the process exits until the client closes it", async () => {
    const piTerminalStub = createPiTerminalStub();
    const controlServer = await startDevtoolsControlServer({
      componentEditor: "vscode",
      devtoolsMinimapPosition: "left",
      devtoolsPosition: "bottom-right",
      getHealthResponse: async (): Promise<HealthResponse> => {
        return {
          services: [],
        };
      },
      projectRootPath: "/tmp/project",
      stackName: "hello-stack",
      startPiTerminalSession: piTerminalStub.start,
    });

    stopFunctions.push(controlServer.stop);

    const injectedScriptResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${INJECTED_SCRIPT_PATH}`);
    const controlToken: string = extractControlToken(await injectedScriptResponse.text());
    const startResponse: Response = await fetch(`http://127.0.0.1:${controlServer.port}${PI_SESSION_START_PATH}`, {
      body: JSON.stringify({
        annotation: createAnnotationDetail(),
      }),
      headers: {
        "content-type": "application/json",
        "x-devhost-control-token": controlToken,
      },
      method: "POST",
    });
    const startResponseBody: unknown = await startResponse.json();

    expect(startResponse.status).toBe(200);
    expect(isSessionStartResponse(startResponseBody)).toBe(true);

    const websocketUrl: URL = new URL(`ws://127.0.0.1:${controlServer.port}${PI_SESSION_WEBSOCKET_PATH}`);

    websocketUrl.searchParams.set("sessionId", (startResponseBody as { sessionId: string }).sessionId);
    websocketUrl.searchParams.set("token", controlToken);

    const websocket = new WebSocket(websocketUrl);

    websockets.push(websocket);

    await expect(waitForWebSocketMessage(websocket)).resolves.toBe(JSON.stringify({ data: "", type: "snapshot" }));

    const exitMessagePromise: Promise<string> = waitForWebSocketMessage(websocket);

    piTerminalStub.exitWith(0, null);

    await expect(exitMessagePromise).resolves.toBe(JSON.stringify({ exitCode: 0, signalCode: null, type: "exit" }));

    websocket.send(JSON.stringify({ data: "ignored after exit\n", type: "input" }));
    websocket.send(JSON.stringify({ cols: 120, rows: 40, type: "resize" }));

    await Bun.sleep(0);

    expect(websocket.readyState).toBe(WebSocket.OPEN);
    expect(piTerminalStub.closeCount).toBe(0);
    expect(piTerminalStub.resizes).toEqual([]);
    expect(piTerminalStub.writes).toEqual([]);

    const closePromise: Promise<void> = waitForWebSocketClose(websocket);

    websocket.send(JSON.stringify({ type: "close" }));

    await closePromise;

    expect(piTerminalStub.closeCount).toBe(1);
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

function createPiTerminalStub(): {
  closeCount: number;
  emit: (text: string) => void;
  exitWith: (exitCode: number, signalCode: string | null) => void;
  resizes: Array<{ cols: number; rows: number }>;
  start: (detail: IAnnotationSubmitDetail, onData: (data: Uint8Array) => void) => ILaunchedPiTerminalSession;
  startedAnnotations: IAnnotationSubmitDetail[];
  writes: string[];
} {
  const encoder: TextEncoder = new TextEncoder();
  const resizes: Array<{ cols: number; rows: number }> = [];
  const startedAnnotations: IAnnotationSubmitDetail[] = [];
  const writes: string[] = [];
  let closeCount: number = 0;
  let dataHandler: ((data: Uint8Array) => void) | null = null;
  let exitCode: number | null = null;
  let resolveExit: ((value: number) => void) | null = null;
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
    start: (detail: IAnnotationSubmitDetail, onData: (data: Uint8Array) => void): ILaunchedPiTerminalSession => {
      startedAnnotations.push(detail);
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
    startedAnnotations,
    writes,
  };
}

function extractControlToken(injectedScript: string): string {
  const tokenMatch: RegExpMatchArray | null = injectedScript.match(/"controlToken":"([^"]+)"/);

  if (tokenMatch === null) {
    throw new Error("Expected the injected script to include a control token.");
  }

  return tokenMatch[1];
}

function isSessionStartResponse(value: unknown): value is { sessionId: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const sessionId: unknown = Reflect.get(value, "sessionId");

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

      if (typeof event.data !== "string") {
        reject(new Error("Expected a text websocket message."));
        return;
      }

      resolve(event.data);
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
