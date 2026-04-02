import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
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
import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import type { PiTerminalClientMessage, PiTerminalServerMessage } from "./types";

interface IDevtoolsPiTerminalPanelProps {
  annotation: IAnnotationSubmitDetail;
  isExpanded: boolean;
  onExpand: () => void;
  onMinimize: () => void;
  onTerminate: () => void;
  sessionId: string;
  theme: IDevtoolsTheme;
}

interface IPanelSize {
  height: number;
  width: number;
}

const maximumPanelHeight: number = 720;
const maximumPanelWidth: number = 1040;
const normalClosureCode: number = 1000;
const panelViewportMargin: number = 24;
const trayScale: number = 0.32;
const trayTransitionDurationInMilliseconds: number = 180;
const xtermStylesheetId: string = "devhost-xterm-stylesheet";

export function DevtoolsPiTerminalPanel(props: IDevtoolsPiTerminalPanelProps): JSX.Element {
  const fitAddonReference = useRef<FitAddon | null>(null);
  const resizeAnimationFrameReference = useRef<number | null>(null);
  const terminalContainerReference = useRef<HTMLDivElement | null>(null);
  const terminalReference = useRef<Terminal | null>(null);
  const terminalViewportReference = useRef<HTMLDivElement | null>(null);
  const websocketReference = useRef<WebSocket | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTrayHoverVisible, setIsTrayHoverVisible] = useState<boolean>(false);
  const [isTrayMounted, setIsTrayMounted] = useState<boolean>(false);
  const [panelSize, setPanelSize] = useState<IPanelSize>(() => {
    return resolvePanelSize(window.innerWidth, window.innerHeight);
  });
  const [statusText, setStatusText] = useState<string>("Connecting to Pi…");

  const scheduleTerminalResize = useCallback((): void => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const websocket: WebSocket | null = websocketReference.current;

    if (fitAddon === null || terminal === null || websocket === null) {
      return;
    }

    if (resizeAnimationFrameReference.current !== null) {
      return;
    }

    resizeAnimationFrameReference.current = window.requestAnimationFrame((): void => {
      resizeAnimationFrameReference.current = null;
      resizeTerminal(terminal, fitAddon, websocket);
    });
  }, []);

  useEffect(() => {
    const handleWindowResize = (): void => {
      setPanelSize(resolvePanelSize(window.innerWidth, window.innerHeight));
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, []);

  useEffect(() => {
    if (props.isExpanded) {
      setIsTrayMounted(false);
      return;
    }

    let animationFrameId: number = 0;

    setIsTrayMounted(false);
    animationFrameId = window.requestAnimationFrame((): void => {
      setIsTrayMounted(true);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [props.isExpanded, props.sessionId]);

  useEffect(() => {
    ensureXtermStylesheet();

    const terminalContainer: HTMLDivElement | null = terminalContainerReference.current;
    const terminalViewport: HTMLDivElement | null = terminalViewportReference.current;

    if (terminalContainer === null || terminalViewport === null) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      cols: 120,
      cursorBlink: true,
      disableStdin: !props.isExpanded,
      fontFamily: props.theme.fontFamilies.monospace,
      fontSize: Number.parseInt(props.theme.fontSizes.md, 10),
      rows: 80,
      scrollback: 2_000,
      theme: createXtermTheme(props.theme),
    });
    const fitAddon = new FitAddon();
    const websocketUrl: URL = new URL(createDevtoolsWebSocketUrl(PI_SESSION_WEBSOCKET_PATH, window.location));
    const websocket = new WebSocket(appendPiSessionParameters(websocketUrl, props.sessionId).toString());

    fitAddonReference.current = fitAddon;
    terminalReference.current = terminal;
    websocketReference.current = websocket;
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainer);

    const resizeObserver = new ResizeObserver((): void => {
      scheduleTerminalResize();
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
      scheduleTerminalResize();

      if (props.isExpanded) {
        terminal.focus();
      }
    };
    const handleClose = (): void => {
      setStatusText("Pi session disconnected");
      setIsTrayHoverVisible(false);
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
    resizeObserver.observe(terminalViewport);
    scheduleTerminalResize();

    return () => {
      resizeObserver.disconnect();
      dataListener.dispose();
      websocket.removeEventListener("open", handleOpen);
      websocket.removeEventListener("close", handleClose);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("message", handleMessage);

      if (resizeAnimationFrameReference.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameReference.current);
        resizeAnimationFrameReference.current = null;
      }

      if (websocket.readyState !== WebSocket.CLOSED) {
        websocket.close(normalClosureCode, "devtools panel closed");
      }

      terminal.dispose();
      fitAddonReference.current = null;
      terminalReference.current = null;
      websocketReference.current = null;
    };
  }, [props.sessionId, scheduleTerminalResize]);

  useEffect(() => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const websocket: WebSocket | null = websocketReference.current;

    if (fitAddon === null || terminal === null || websocket === null) {
      return;
    }

    terminal.options.disableStdin = !props.isExpanded;
    terminal.options.theme = createXtermTheme(props.theme);
    terminal.options.fontFamily = props.theme.fontFamilies.monospace;
    terminal.options.fontSize = Number.parseInt(props.theme.fontSizes.md, 10);

    if (props.isExpanded) {
      terminal.focus();
    } else {
      terminal.blur();
      setIsTrayHoverVisible(false);
    }

    scheduleTerminalResize();
  }, [panelSize, props.isExpanded, props.theme, scheduleTerminalResize]);

  const panelContent: JSX.Element = (
    <div style={createChromeStyle(props.theme, panelSize)}>
      <header data-testid="DevtoolsPiTerminalPanel--header" style={createHeaderStyle(props.theme)}>
        <div style={headerTextStyle}>
          <strong>Pi terminal</strong>
          <span style={createStatusStyle(props.theme, errorMessage !== null)}>{errorMessage ?? statusText}</span>
        </div>
        {props.isExpanded ? (
          <div style={buttonGroupStyle}>
            <Button
              testId="DevtoolsPiTerminalPanel--minimize"
              theme={props.theme}
              title="Minimize Pi terminal"
              variant="secondary"
              onClick={props.onMinimize}
            >
              Minimize
            </Button>
            <Button
              testId="DevtoolsPiTerminalPanel--terminate"
              theme={props.theme}
              title="Terminate Pi terminal"
              variant="danger"
              onClick={(): void => {
                terminateSession(websocketReference.current);
                props.onTerminate();
              }}
            >
              Terminate
            </Button>
          </div>
        ) : null}
      </header>
      {props.isExpanded ? (
        <section data-testid="DevtoolsPiTerminalPanel--annotation" style={createAnnotationStyle(props.theme)}>
          <span style={createAnnotationEyebrowStyle(props.theme)}>Original annotation</span>
          <strong style={createAnnotationCommentStyle(props.theme)}>{props.annotation.comment}</strong>
          <div style={createAnnotationMetaStyle(props.theme)}>
            <span>{props.annotation.markers.length} markers</span>
            <span>{props.annotation.title}</span>
            <span>{new URL(props.annotation.url).host}</span>
            <span>{new Date(props.annotation.submittedAt).toLocaleString()}</span>
          </div>
        </section>
      ) : null}
      <div ref={terminalViewportReference} data-testid="DevtoolsPiTerminalPanel--terminal" style={createTerminalViewportStyle(props.theme)}>
        <div ref={terminalContainerReference} style={terminalContainerStyle} />
      </div>
    </div>
  );

  if (props.isExpanded) {
    return (
      <section data-testid="DevtoolsPiTerminalPanel" style={createExpandedPanelStyle(props.theme, panelSize)}>
        {panelContent}
      </section>
    );
  }

  return (
    <section data-testid="DevtoolsPiTerminalPanel" style={createTrayShellStyle(props.theme, panelSize, isTrayMounted)}>
      <div style={createTrayScaledContentStyle(panelSize)}>{panelContent}</div>
      <button
        aria-label="Expand Pi terminal preview"
        data-testid="DevtoolsPiTerminalPanel--expand"
        style={createTrayOverlayButtonStyle(props.theme)}
        type="button"
        onBlur={(): void => {
          setIsTrayHoverVisible(false);
        }}
        onClick={props.onExpand}
        onFocus={(): void => {
          setIsTrayHoverVisible(true);
        }}
        onMouseEnter={(): void => {
          setIsTrayHoverVisible(true);
        }}
        onMouseLeave={(): void => {
          setIsTrayHoverVisible(false);
        }}
      >
        <span style={createTrayBadgeStyle(props.theme)}>{errorMessage ?? statusText}</span>
      </button>
      {isTrayHoverVisible ? (
        <div data-testid="DevtoolsPiTerminalPanel--tooltip" style={createTrayTooltipStyle(props.theme)}>
          <span style={createAnnotationEyebrowStyle(props.theme)}>Original annotation</span>
          <strong style={createTrayTooltipCommentStyle(props.theme)}>{props.annotation.comment}</strong>
        </div>
      ) : null}
    </section>
  );
}

function appendPiSessionParameters(websocketUrl: URL, sessionId: string): URL {
  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, readDevtoolsControlToken());
  websocketUrl.searchParams.set(PI_SESSION_ID_QUERY_PARAMETER_NAME, sessionId);

  return websocketUrl;
}

function createAnnotationCommentStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    fontSize: theme.fontSizes.lg,
    lineHeight: 1.45,
  };
}

function createAnnotationEyebrowStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };
}

function createAnnotationMetaStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createAnnotationStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.selectionBorder}`,
    borderRadius: theme.radii.md,
    background: theme.colors.selectionBackground,
  };
}

function createChromeStyle(theme: IDevtoolsTheme, panelSize: IPanelSize): JSX.CSSProperties {
  return {
    width: `${panelSize.width}px`,
    height: `${panelSize.height}px`,
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    boxSizing: "border-box",
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    background: theme.colors.background,
    color: theme.colors.foreground,
    boxShadow: theme.shadows.floating,
  };
}

function createExpandedPanelStyle(theme: IDevtoolsTheme, panelSize: IPanelSize): JSX.CSSProperties {
  return {
    position: "fixed",
    top: "50%",
    left: "50%",
    width: `${panelSize.width}px`,
    height: `${panelSize.height}px`,
    transform: "translate(-50%, -50%)",
    pointerEvents: "auto",
    zIndex: Number(theme.zIndices.floating) + 2,
  };
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
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  };
}

function createStatusStyle(theme: IDevtoolsTheme, isError: boolean): JSX.CSSProperties {
  return {
    color: isError ? theme.colors.dangerForeground : theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
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

function createTrayBadgeStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "absolute",
    left: theme.spacing.xs,
    right: theme.spacing.xs,
    bottom: theme.spacing.xs,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radii.pill,
    background: theme.colors.logMinimapOverlayBackground,
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
    textAlign: "left",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  };
}

function createTrayOverlayButtonStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.lg,
    background: "transparent",
    cursor: "pointer",
    overflow: "hidden",
  };
}

function createTrayScaledContentStyle(panelSize: IPanelSize): JSX.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: `${panelSize.width}px`,
    height: `${panelSize.height}px`,
    transform: `scale(${trayScale})`,
    transformOrigin: "bottom left",
    pointerEvents: "none",
  };
}

function createTrayShellStyle(theme: IDevtoolsTheme, panelSize: IPanelSize, isTrayMounted: boolean): JSX.CSSProperties {
  return {
    position: "relative",
    flex: "0 0 auto",
    width: isTrayMounted ? `${panelSize.width * trayScale}px` : "0px",
    height: `${panelSize.height * trayScale}px`,
    opacity: isTrayMounted ? 1 : 0,
    transform: isTrayMounted ? "translateY(0px)" : "translateY(16px)",
    transition: [
      `width ${trayTransitionDurationInMilliseconds}ms ease`,
      `opacity ${trayTransitionDurationInMilliseconds}ms ease`,
      `transform ${trayTransitionDurationInMilliseconds}ms ease`,
    ].join(", "),
    pointerEvents: "auto",
    overflow: "visible",
    zIndex: Number(theme.zIndices.floating) + 1,
  };
}

function createTrayTooltipCommentStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    color: theme.colors.foreground,
    lineHeight: 1.45,
  };
}

function createTrayTooltipStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "absolute",
    left: 0,
    bottom: `calc(100% + ${theme.spacing.xs})`,
    width: "min(360px, calc(100vw - 48px))",
    display: "grid",
    gap: theme.spacing.xxs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    boxShadow: theme.shadows.floating,
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

function resolvePanelSize(viewportWidth: number, viewportHeight: number): IPanelSize {
  return {
    height: Math.max(240, Math.min(maximumPanelHeight, viewportHeight - panelViewportMargin)),
    width: Math.max(320, Math.min(maximumPanelWidth, viewportWidth - panelViewportMargin)),
  };
}

function sendClientMessage(websocket: WebSocket, message: PiTerminalClientMessage): void {
  if (websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  websocket.send(JSON.stringify(message));
}

function terminateSession(websocket: WebSocket | null): void {
  if (websocket !== null && websocket.readyState === WebSocket.OPEN) {
    sendClientMessage(websocket, {
      type: "close",
    });
  }
}

const buttonGroupStyle: JSX.CSSProperties = {
  display: "flex",
  gap: "8px",
};

const headerTextStyle: JSX.CSSProperties = {
  display: "grid",
};

const terminalContainerStyle: JSX.CSSProperties = {
  width: "100%",
  height: "100%",
};
