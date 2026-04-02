import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { Button, type IDevtoolsTheme } from "../../shared";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import {
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  PI_SESSION_ID_QUERY_PARAMETER_NAME,
  PI_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import type { PiTerminalClientMessage, PiTerminalServerMessage } from "./types";

interface IDevtoolsPiTerminalPanelProps {
  onClose: () => void;
  sessionId: string;
  theme: IDevtoolsTheme;
}

const normalClosureCode: number = 1000;
const xtermStylesheetId: string = "devhost-xterm-stylesheet";

export function DevtoolsPiTerminalPanel(props: IDevtoolsPiTerminalPanelProps): JSX.Element {
  const terminalContainerReference = useRef<HTMLDivElement | null>(null);
  const terminalReference = useRef<Terminal | null>(null);
  const websocketReference = useRef<WebSocket | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("Connecting to Pi…");

  useEffect(() => {
    ensureXtermStylesheet();

    const terminalContainer: HTMLDivElement | null = terminalContainerReference.current;

    if (terminalContainer === null) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cols: 120,
      cursorBlink: true,
      fontFamily: props.theme.fontFamilies.monospace,
      fontSize: Number.parseInt(props.theme.fontSizes.md, 10),
      rows: 80,
      scrollback: 2_000,
      theme: createXtermTheme(props.theme),
    });
    const fitAddon = new FitAddon();
    const websocketUrl: URL = new URL(createDevtoolsWebSocketUrl(PI_SESSION_WEBSOCKET_PATH, window.location));
    const websocket = new WebSocket(appendPiSessionParameters(websocketUrl, props.sessionId).toString());

    terminalReference.current = terminal;
    websocketReference.current = websocket;
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainer);

    const resizeObserver = new ResizeObserver((): void => {
      resizeTerminal(terminal, fitAddon, websocket);
    });
    const dataListener = terminal.onData((data: string): void => {
      sendClientMessage(websocket, {
        data,
        type: "input",
      });
    });
    const handleOpen = (): void => {
      setErrorMessage(null);
      setStatusText("Pi session is running");
      resizeTerminal(terminal, fitAddon, websocket);
    };
    const handleClose = (): void => {
      setStatusText("Pi session disconnected");
    };
    const handleError = (): void => {
      setErrorMessage("The Pi terminal websocket failed.");
    };
    const handleMessage = (event: MessageEvent<string>): void => {
      const message: PiTerminalServerMessage | null = parsePiTerminalServerMessage(event.data);

      if (message === null) {
        setErrorMessage("Received an invalid Pi terminal message.");
        return;
      }

      if (message.type === "snapshot" || message.type === "output") {
        terminal.write(message.data);
        return;
      }

      if (message.type === "exit") {
        setStatusText(createExitStatusText(message.exitCode, message.signalCode));
        return;
      }

      setErrorMessage(message.message);
    };

    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("close", handleClose);
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("message", handleMessage);
    resizeObserver.observe(terminalContainer);
    window.requestAnimationFrame((): void => {
      resizeTerminal(terminal, fitAddon, websocket);
    });

    return () => {
      resizeObserver.disconnect();
      dataListener.dispose();
      websocket.removeEventListener("open", handleOpen);
      websocket.removeEventListener("close", handleClose);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("message", handleMessage);

      if (websocket.readyState !== WebSocket.CLOSED) {
        websocket.close(normalClosureCode, "devtools panel closed");
      }

      terminal.dispose();
      terminalReference.current = null;
      websocketReference.current = null;
    };
  }, [props.sessionId]);

  useEffect(() => {
    const terminal: Terminal | null = terminalReference.current;

    if (terminal === null) {
      return;
    }

    terminal.options.theme = createXtermTheme(props.theme);
    terminal.options.fontFamily = props.theme.fontFamilies.monospace;
    terminal.options.fontSize = Number.parseInt(props.theme.fontSizes.md, 10);
  }, [props.theme]);

  return (
    <section data-testid="DevtoolsPiTerminalPanel" style={createPanelStyle(props.theme)}>
      <header data-testid="DevtoolsPiTerminalPanel--header" style={createHeaderStyle(props.theme)}>
        <div style={headerTextStyle}>
          <strong>Pi terminal</strong>
          <span style={createStatusStyle(props.theme, errorMessage !== null)}>{errorMessage ?? statusText}</span>
        </div>
        <Button
          testId="DevtoolsPiTerminalPanel--close"
          theme={props.theme}
          title="Close Pi terminal"
          variant="secondary"
          onClick={(): void => {
            const websocket: WebSocket | null = websocketReference.current;

            if (websocket !== null && websocket.readyState === WebSocket.OPEN) {
              sendClientMessage(websocket, {
                type: "close",
              });
            }

            props.onClose();
          }}
        >
          Close
        </Button>
      </header>
      <div data-testid="DevtoolsPiTerminalPanel--terminal" style={createTerminalViewportStyle(props.theme)}>
        <div ref={terminalContainerReference} style={terminalContainerStyle} />
      </div>
    </section>
  );
}

function appendPiSessionParameters(websocketUrl: URL, sessionId: string): URL {
  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, readDevtoolsControlToken());
  websocketUrl.searchParams.set(PI_SESSION_ID_QUERY_PARAMETER_NAME, sessionId);

  return websocketUrl;
}

function createExitStatusText(exitCode: number | null, signalCode: string | null): string {
  if (signalCode !== null) {
    return `Pi exited via ${signalCode}.`;
  }

  if (exitCode === null) {
    return "Pi exited.";
  }

  return `Pi exited with code ${exitCode}.`;
}

function createHeaderStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing.sm,
  };
}

function createPanelStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(1100px, calc(100vw - 24px))",
    height: "min(760px, calc(100vh - 24px))",
    display: "grid",
    gridTemplateRows: "auto 1fr",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    boxSizing: "border-box",
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    background: theme.colors.background,
    color: theme.colors.foreground,
    boxShadow: theme.shadows.floating,
    zIndex: theme.zIndices.floating,
  };
}

function createStatusStyle(theme: IDevtoolsTheme, isError: boolean): JSX.CSSProperties {
  return {
    color: isError ? theme.colors.dangerForeground : theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createTerminalViewportStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    minHeight: 0,
    overflow: "hidden",
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
  };
}

function createXtermTheme(theme: IDevtoolsTheme): NonNullable<ConstructorParameters<typeof Terminal>[0]>["theme"] {
  return {
    background: theme.colors.background,
    cursor: theme.colors.accentBackground,
    foreground: theme.colors.foreground,
    selectionBackground: theme.colors.selectionBackground,
  };
}

function ensureXtermStylesheet(): void {
  if (document.getElementById(xtermStylesheetId) !== null) {
    return;
  }

  const stylesheetLink: HTMLLinkElement = document.createElement("link");

  stylesheetLink.id = xtermStylesheetId;
  stylesheetLink.rel = "stylesheet";
  stylesheetLink.href = XTERM_STYLESHEET_PATH;
  document.head.append(stylesheetLink);
}

function parsePiTerminalServerMessage(messageText: string): PiTerminalServerMessage | null {
  const parsedValue: unknown = JSON.parse(messageText);

  if (typeof parsedValue !== "object" || parsedValue === null) {
    return null;
  }

  const messageType: unknown = Reflect.get(parsedValue, "type");

  if (messageType === "snapshot" || messageType === "output") {
    const data: unknown = Reflect.get(parsedValue, "data");

    if (typeof data !== "string") {
      return null;
    }

    return {
      data,
      type: messageType,
    };
  }

  if (messageType === "exit") {
    const exitCode: unknown = Reflect.get(parsedValue, "exitCode");
    const signalCode: unknown = Reflect.get(parsedValue, "signalCode");

    if ((typeof exitCode !== "number" && exitCode !== null) || (typeof signalCode !== "string" && signalCode !== null)) {
      return null;
    }

    return {
      exitCode,
      signalCode,
      type: "exit",
    };
  }

  if (messageType === "error") {
    const errorMessage: unknown = Reflect.get(parsedValue, "message");

    if (typeof errorMessage !== "string") {
      return null;
    }

    return {
      message: errorMessage,
      type: "error",
    };
  }

  return null;
}

function resizeTerminal(terminal: Terminal, fitAddon: FitAddon, websocket: WebSocket): void {
  fitAddon.fit();

  if (terminal.cols === 0 || terminal.rows === 0) {
    return;
  }

  sendClientMessage(websocket, {
    cols: terminal.cols,
    rows: terminal.rows,
    type: "resize",
  });
}

function sendClientMessage(websocket: WebSocket, message: PiTerminalClientMessage): void {
  if (websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  websocket.send(JSON.stringify(message));
}

const headerTextStyle: JSX.CSSProperties = {
  display: "grid",
};

const terminalContainerStyle: JSX.CSSProperties = {
  width: "100%",
  height: "100%",
};
