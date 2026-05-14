import type { CSSProperties, JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";

import { Button, useDevtoolsColorScheme } from "../../../shared";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import {
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../../../shared/constants";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import { readTerminalTheme, type ITerminalTheme } from "../readTerminalTheme";
import { readTerminalSessionPrimaryAction } from "../readTerminalSessionPrimaryAction";
import { resolveTerminalPanelLayout, type IPanelSize } from "../resolveTerminalPanelLayout";
import { shouldAutoRemoveTerminalSession } from "../shouldAutoRemoveTerminalSession";
import type {
  TerminalSession,
  ITerminalSessionSummary,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
} from "../types";

interface ITerminalSessionPanelProps {
  isExpanded: boolean;
  onExpand: () => void;
  onMinimize: () => void;
  onRemove: () => void;
  session: TerminalSession;
}

interface ITrayTooltipLayout {
  bottom: number;
  left: number;
  width: number;
}

interface IDimensionStyle extends CSSProperties {
  height: number | string;
  width: number | string;
}

interface IExpandedPanelStyle extends IDimensionStyle {
  left: string;
  top: string;
  transform: string;
}

interface ITrayShellStyle extends IDimensionStyle {
  opacity: number;
}

interface ITrayTooltipStyle extends CSSProperties {
  bottom?: number;
  left?: number;
  width?: number;
}

const normalClosureCode: number = 1000;
const trayScale: number = 0.32;
const xtermStylesheetId: string = "devhost-xterm-stylesheet";

export function TerminalSessionPanel(props: ITerminalSessionPanelProps): JSX.Element {
  const { controlToken } = readInjectedDevtoolsConfig();
  const colorScheme = useDevtoolsColorScheme();
  const terminalTheme: ITerminalTheme = useMemo((): ITerminalTheme => {
    return readTerminalTheme(colorScheme);
  }, [colorScheme]);
  const fitAddonReference = useRef<FitAddon | null>(null);
  const hasExitedReference = useRef<boolean>(false);
  const resizeAnimationFrameReference = useRef<number | null>(null);
  const terminalContainerReference = useRef<HTMLDivElement | null>(null);
  const terminalReference = useRef<Terminal | null>(null);
  const terminalViewportReference = useRef<HTMLDivElement | null>(null);
  const terminalThemeReference = useRef<ITerminalTheme>(terminalTheme);
  const trayShellReference = useRef<HTMLElement | null>(null);
  const websocketReference = useRef<WebSocket | null>(null);
  const isExpandedReference = useRef<boolean>(props.isExpanded);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasExited, setHasExited] = useState<boolean>(false);
  const [isTrayHoverVisible, setIsTrayHoverVisible] = useState<boolean>(false);
  const [isTrayMounted, setIsTrayMounted] = useState<boolean>(false);
  const [trayTooltipLayout, setTrayTooltipLayout] = useState<ITrayTooltipLayout | null>(null);
  const [viewportSize, setViewportSize] = useState<IPanelSize>(() => {
    return {
      height: window.innerHeight,
      width: window.innerWidth,
    };
  });
  const [statusText, setStatusText] = useState<string>("Connecting…");
  const onRemove = props.onRemove;
  const session: TerminalSession = props.session;
  const discardSession = useCallback((): void => {
    terminateSession(websocketReference.current);
    onRemove();
  }, [onRemove]);

  terminalThemeReference.current = terminalTheme;
  isExpandedReference.current = props.isExpanded;
  const terminalPanelLayout = resolveTerminalPanelLayout(
    props.session.behavior,
    viewportSize.width,
    viewportSize.height,
  );
  const activePanelSize: IPanelSize = props.isExpanded
    ? terminalPanelLayout.expandedPanelSize
    : terminalPanelLayout.trayPanelSize;

  const scheduleTerminalResize = useCallback((): void => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const websocket: WebSocket | null = websocketReference.current;

    if (hasExitedReference.current || fitAddon === null || terminal === null || websocket === null) {
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
      setViewportSize({
        height: window.innerHeight,
        width: window.innerWidth,
      });
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
  }, [props.isExpanded, props.session.sessionId]);

  const updateTrayTooltipLayout = useCallback((): void => {
    const trayShell: HTMLElement | null = trayShellReference.current;

    if (trayShell === null) {
      return;
    }

    const trayShellBounds: DOMRect = trayShell.getBoundingClientRect();

    setTrayTooltipLayout(resolveTrayTooltipLayout(trayShellBounds, window.innerWidth, window.innerHeight));
  }, []);

  useEffect(() => {
    if (!props.isExpanded) {
      return;
    }

    const { body, documentElement } = document;
    const previousBodyOverflow: string = body.style.overflow;
    const previousDocumentOverflow: string = documentElement.style.overflow;

    body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";

    return () => {
      body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [props.isExpanded]);

  useEffect(() => {
    if (!isTrayHoverVisible || props.isExpanded) {
      return;
    }

    const handleWindowResize = (): void => {
      updateTrayTooltipLayout();
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [isTrayHoverVisible, props.isExpanded, updateTrayTooltipLayout]);

  useEffect(() => {
    const terminalContainer: HTMLDivElement | null = terminalContainerReference.current;
    const terminalViewport: HTMLDivElement | null = terminalViewportReference.current;

    setErrorMessage(null);
    setHasExited(false);
    hasExitedReference.current = false;
    setStatusText("Connecting…");

    if (terminalContainer === null || terminalViewport === null) {
      return;
    }

    ensureXtermStylesheet(terminalContainer.getRootNode());

    const currentTheme: ITerminalTheme = terminalThemeReference.current;
    const terminal = new Terminal({
      allowTransparency: true,
      cols: 120,
      cursorBlink: true,
      disableStdin: !isExpandedReference.current,
      fontFamily: currentTheme.fontFamily,
      fontSize: currentTheme.fontSize,
      rows: 80,
      scrollback: 2_000,
      theme: currentTheme.theme,
    });
    const fitAddon = new FitAddon();
    const websocketUrl: URL = new URL(createDevtoolsWebSocketUrl(TERMINAL_SESSION_WEBSOCKET_PATH, window.location));
    const websocket = new WebSocket(
      appendTerminalSessionParameters(websocketUrl, props.session.sessionId, controlToken).toString(),
    );

    fitAddonReference.current = fitAddon;
    terminalReference.current = terminal;
    websocketReference.current = websocket;
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainer);

    const resizeObserver = new ResizeObserver((): void => {
      scheduleTerminalResize();
    });
    const oscListener = terminal.parser.registerOscHandler(1337, (data: string): boolean => {
      if (data === "SetAgentStatus=working") {
        setStatusText("Working…");
        return true;
      }
      if (data === "SetAgentStatus=finished") {
        setStatusText("Finished");
        return true;
      }
      return false;
    });
    const dataListener = terminal.onData((data: string): void => {
      sendClientMessage(websocket, {
        data,
        type: "input",
      });
    });
    const handleOpen = (): void => {
      setErrorMessage(null);
      setStatusText("Connected");
      scheduleTerminalResize();

      if (isExpandedReference.current) {
        terminal.focus();
      }
    };
    const handleClose = (): void => {
      if (!hasExitedReference.current) {
        setStatusText("Terminal session disconnected");
      }

      setIsTrayHoverVisible(false);
    };
    const handleError = (): void => {
      setErrorMessage("The terminal websocket failed.");
    };
    const handleMessage = (event: MessageEvent<string>): void => {
      const message: TerminalSessionServerMessage | null = parseTerminalSessionServerMessage(event.data);

      if (message === null) {
        setErrorMessage("Received an invalid terminal message.");
        return;
      }

      if (message.type === "snapshot" || message.type === "output") {
        terminal.write(message.data);
        return;
      }

      if (message.type === "exit") {
        hasExitedReference.current = true;
        setHasExited(true);
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
      oscListener.dispose();
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
  }, [controlToken, props.session.sessionId, scheduleTerminalResize]);

  useEffect(() => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const websocket: WebSocket | null = websocketReference.current;

    if (fitAddon === null || terminal === null || websocket === null) {
      return;
    }

    terminal.options.disableStdin = !props.isExpanded || hasExited;
    terminal.options.theme = terminalTheme.theme;
    terminal.options.fontFamily = terminalTheme.fontFamily;
    terminal.options.fontSize = terminalTheme.fontSize;

    if (props.isExpanded && !hasExited) {
      terminal.focus();
    } else {
      terminal.blur();
      setIsTrayHoverVisible(false);
    }

    scheduleTerminalResize();
  }, [
    activePanelSize.height,
    activePanelSize.width,
    hasExited,
    props.isExpanded,
    scheduleTerminalResize,
    terminalTheme,
  ]);

  useEffect(() => {
    if (!shouldAutoRemoveTerminalSession(session, hasExited)) {
      return;
    }

    onRemove();
  }, [hasExited, onRemove, session]);

  const primaryAction = readTerminalSessionPrimaryAction(hasExited);
  const sessionSummary: ITerminalSessionSummary = props.session.summary;
  const isFullscreenExpanded: boolean = terminalPanelLayout.isFullscreenExpanded && props.isExpanded;
  const chromeStyle: IDimensionStyle = {
    height: activePanelSize.height,
    width: activePanelSize.width,
  };
  const expandedPanelStyle: IExpandedPanelStyle = readExpandedPanelStyle(
    activePanelSize,
    terminalPanelLayout.isFullscreenExpanded,
  );
  const trayScaledContentStyle: IDimensionStyle = {
    height: terminalPanelLayout.trayPanelSize.height,
    transform: `scale(${trayScale})`,
    transformOrigin: "bottom left",
    width: terminalPanelLayout.trayPanelSize.width,
  };
  const trayShellStyle: ITrayShellStyle = {
    height: terminalPanelLayout.trayPanelSize.height * trayScale,
    opacity: isTrayMounted ? 1 : 0,
    width: isTrayMounted ? terminalPanelLayout.trayPanelSize.width * trayScale : 0,
  };
  const trayTooltipStyle: ITrayTooltipStyle =
    trayTooltipLayout === null
      ? { display: "none" }
      : {
          bottom: trayTooltipLayout.bottom,
          left: trayTooltipLayout.left,
          width: trayTooltipLayout.width,
        };

  const panelContent: JSX.Element = (
    <div
      className={[
        "box-border grid grid-rows-[auto_auto_1fr] gap-2.5 bg-background p-2.5 text-foreground",
        isFullscreenExpanded ? "rounded-none border-0 shadow-none" : "rounded-md border border-border shadow-lg",
      ].join(" ")}
      style={chromeStyle}
    >
      <header className="flex items-start justify-between gap-2.5" data-testid="TerminalSessionPanel--header">
        <div className="grid">
          <strong>{sessionSummary.terminalTitle}</strong>
          <span
            className={
              errorMessage !== null
                ? "text-xs leading-normal text-destructive"
                : "text-xs leading-normal text-muted-foreground"
            }
          >
            {errorMessage ?? statusText}
          </span>
        </div>
        {props.isExpanded ? (
          <div className="flex gap-2">
            <Button
              testId="TerminalSessionPanel--minimize"
              title={`Minimize ${sessionSummary.terminalTitle}`}
              variant="secondary"
              onClick={props.onMinimize}
            >
              Minimize
            </Button>
            <Button
              testId={primaryAction.testId}
              title={primaryAction.title}
              variant={primaryAction.variant}
              onClick={discardSession}
            >
              {primaryAction.label}
            </Button>
          </div>
        ) : null}
      </header>
      {props.isExpanded ? (
        props.session.kind === "editor" ? (
          <section
            className="flex min-w-0 items-center gap-2.5 rounded-sm border border-primary bg-accent px-2.5 py-2"
            data-testid="TerminalSessionPanel--summary"
          >
            <strong className="flex-none text-base leading-normal">{sessionSummary.headline}</strong>
            <span className="min-w-0 flex-auto truncate text-xs text-muted-foreground">{sessionSummary.meta[0]}</span>
          </section>
        ) : (
          <section
            className="grid gap-2 rounded-sm border border-primary bg-accent p-2.5"
            data-testid="TerminalSessionPanel--summary"
          >
            <span className="text-xs uppercase tracking-normal text-muted-foreground">{sessionSummary.eyebrow}</span>
            <strong className="text-base leading-normal">{sessionSummary.headline}</strong>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {sessionSummary.meta.map((entry: string) => {
                return <span key={entry}>{entry}</span>;
              })}
            </div>
          </section>
        )
      ) : null}
      <div
        ref={terminalViewportReference}
        className="min-h-0 overflow-hidden bg-background"
        data-testid="TerminalSessionPanel--terminal"
      >
        <div ref={terminalContainerReference} className="size-full" />
      </div>
    </div>
  );

  if (props.isExpanded) {
    return (
      <div className="pointer-events-none fixed inset-0 z-[3]" data-testid="TerminalSessionPanel">
        <div
          aria-hidden="true"
          className="pointer-events-auto fixed inset-0 bg-[rgba(26,27,38,0.76)]"
          data-testid="TerminalSessionPanel--backdrop"
        />
        <section
          className="pointer-events-auto fixed z-[1]"
          data-testid="TerminalSessionPanel--content"
          style={expandedPanelStyle}
        >
          {panelContent}
        </section>
      </div>
    );
  }

  return (
    <section
      ref={trayShellReference}
      className={[
        "pointer-events-auto relative z-[1] flex-none overflow-visible opacity-100",
        "transition-[width,opacity] duration-200 ease-in-out",
      ].join(" ")}
      data-testid="TerminalSessionPanel"
      style={trayShellStyle}
      onMouseEnter={(): void => {
        updateTrayTooltipLayout();
        setIsTrayHoverVisible(true);
      }}
      onMouseLeave={(): void => {
        setIsTrayHoverVisible(false);
      }}
    >
      <div className="pointer-events-none absolute bottom-0 left-0" style={trayScaledContentStyle}>
        {panelContent}
      </div>
      <button
        aria-label={`Expand ${sessionSummary.terminalTitle} preview`}
        className="absolute inset-0 cursor-pointer rounded-md border border-border bg-transparent"
        data-testid="TerminalSessionPanel--expand"
        type="button"
        onBlur={(): void => {
          setIsTrayHoverVisible(false);
        }}
        onClick={props.onExpand}
        onFocus={(): void => {
          updateTrayTooltipLayout();
          setIsTrayHoverVisible(true);
        }}
      >
        <span
          className={[
            "absolute inset-x-2 bottom-2 overflow-hidden truncate rounded-md bg-primary/10",
            "px-2 py-1 text-left text-xs text-foreground",
          ].join(" ")}
        >
          {errorMessage ?? statusText}
        </span>
      </button>
      {hasExited && !isTrayHoverVisible ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[1] grid place-items-center"
          data-testid="TerminalSessionPanel--completion-indicator"
        >
          <CircleCheckIcon className="block size-6 fill-current text-primary drop-shadow" />
        </div>
      ) : null}
      {hasExited && isTrayHoverVisible ? (
        <button
          aria-label="Close terminal session"
          className={[
            "absolute inset-0 z-[2] m-auto grid size-6 cursor-pointer appearance-none place-items-center",
            "border-0 bg-transparent p-0 text-primary transition-colors hover:text-destructive",
            "focus-visible:text-destructive focus-visible:outline-none",
          ].join(" ")}
          data-testid="TerminalSessionPanel--tray-close"
          title="Close terminal session"
          type="button"
          onClick={(event: React.MouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation();
            discardSession();
          }}
        >
          <CircleXIcon className="block size-6 fill-current" />
        </button>
      ) : null}
      {isTrayHoverVisible && trayTooltipLayout !== null ? (
        <div
          className={[
            "pointer-events-none fixed z-[2] grid gap-1 rounded-md border border-border",
            "bg-background p-2.5 text-foreground shadow-lg",
          ].join(" ")}
          data-testid="TerminalSessionPanel--tooltip"
          style={trayTooltipStyle}
        >
          <strong className="leading-normal text-foreground">{sessionSummary.trayTooltipPrimary}</strong>
          {sessionSummary.trayTooltipSecondary !== undefined ? (
            <span className="text-xs leading-normal text-muted-foreground">{sessionSummary.trayTooltipSecondary}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function appendTerminalSessionParameters(websocketUrl: URL, sessionId: string, controlToken: string): URL {
  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, controlToken);
  websocketUrl.searchParams.set(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME, sessionId);

  return websocketUrl;
}

function createExitStatusText(_exitCode: number | null, _signalCode: string | null): string {
  return "Finished";
}

function readExpandedPanelStyle(panelSize: IPanelSize, isFullscreen: boolean): IExpandedPanelStyle {
  return {
    height: panelSize.height,
    left: isFullscreen ? "0px" : "50%",
    top: isFullscreen ? "0px" : "50%",
    transform: isFullscreen ? "none" : "translate(-50%, -50%)",
    width: panelSize.width,
  };
}

function resolveTrayTooltipLayout(
  trayShellBounds: DOMRect,
  viewportWidth: number,
  viewportHeight: number,
): ITrayTooltipLayout {
  const viewportPadding: number = 24;
  const width: number = Math.min(trayShellBounds.width, viewportWidth - viewportPadding * 2);
  const left: number = Math.max(
    viewportPadding,
    Math.min(trayShellBounds.left, viewportWidth - viewportPadding - width),
  );
  const bottom: number = viewportHeight - trayShellBounds.top + 8;

  return {
    bottom,
    left,
    width,
  };
}

function ensureXtermStylesheet(rootNode: Node): void {
  if (!(rootNode instanceof ShadowRoot)) {
    throw new Error("The terminal panel must render inside a shadow root.");
  }

  if (rootNode.getElementById(xtermStylesheetId) !== null) {
    return;
  }

  const stylesheetLink: HTMLLinkElement = document.createElement("link");

  stylesheetLink.id = xtermStylesheetId;
  stylesheetLink.rel = "stylesheet";
  stylesheetLink.href = XTERM_STYLESHEET_PATH;
  rootNode.append(stylesheetLink);
}

function parseTerminalSessionServerMessage(messageText: string): TerminalSessionServerMessage | null {
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

    if (
      (typeof exitCode !== "number" && exitCode !== null) ||
      (typeof signalCode !== "string" && signalCode !== null)
    ) {
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

function sendClientMessage(websocket: WebSocket, message: TerminalSessionClientMessage): void {
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
