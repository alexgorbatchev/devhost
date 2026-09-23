import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { CodeIcon, MinusIcon, TerminalIcon, XIcon } from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";

import { Button, InlineNotice, useDevtoolsColorScheme } from "../../../shared";
import { createDevtoolsWebSocketUrl } from "../../../shared/createDevtoolsWebSocketUrl";
import {
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../../../shared/constants";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import { readTerminalSessionPrimaryAction } from "../readTerminalSessionPrimaryAction";
import { readTerminalSessionStatusLabel } from "../readTerminalSessionStatusLabel";
import { readTerminalTheme, type ITerminalTheme } from "../readTerminalTheme";
import { shouldAutoRemoveTerminalSession } from "../shouldAutoRemoveTerminalSession";
import type {
  TerminalSession,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
  TerminalSessionStatus,
} from "../types";

interface ITerminalSessionPanelProps {
  isExpanded: boolean;
  onMinimize: () => void;
  onRemove: () => void;
  onStatusChange: (status: TerminalSessionStatus, errorMessage: string | null) => void;
  session: TerminalSession;
}

type StatusBadgeVariant = "default" | "destructive" | "primary" | "success";

const statusBadgeVariants: Record<TerminalSessionStatus, StatusBadgeVariant> = {
  connecting: "default",
  disconnected: "destructive",
  error: "destructive",
  exited: "success",
  idle: "success",
  running: "primary",
  working: "primary",
};

const normalClosureCode: number = 1000;
const xtermStylesheetId: string = "devhost-xterm-stylesheet";

/**
 * One terminal session window. It stays mounted (hidden) while minimized so the websocket and xterm buffer
 * persist and the session keeps reporting status to its toolbar chip; expanding only reveals it.
 */
export function TerminalSessionPanel(props: ITerminalSessionPanelProps): JSX.Element {
  const { controlToken } = readInjectedDevtoolsConfig();
  const colorScheme = useDevtoolsColorScheme();
  const terminalTheme: ITerminalTheme = useMemo((): ITerminalTheme => {
    return readTerminalTheme(colorScheme);
  }, [colorScheme]);
  const fitAddonReference = useRef<FitAddon | null>(null);
  const hasExitedReference = useRef<boolean>(false);
  const isExpandedReference = useRef<boolean>(props.isExpanded);
  const onStatusChangeReference = useRef(props.onStatusChange);
  const resizeAnimationFrameReference = useRef<number | null>(null);
  const terminalContainerReference = useRef<HTMLDivElement | null>(null);
  const terminalReference = useRef<Terminal | null>(null);
  const terminalThemeReference = useRef<ITerminalTheme>(terminalTheme);
  const terminalViewportReference = useRef<HTMLDivElement | null>(null);
  const websocketReference = useRef<WebSocket | null>(null);
  const { onRemove, session } = props;
  const hasExited: boolean = session.status === "exited";
  const isFullscreen: boolean = session.behavior.isFullscreenExpanded;

  terminalThemeReference.current = terminalTheme;
  isExpandedReference.current = props.isExpanded;
  onStatusChangeReference.current = props.onStatusChange;

  const discardSession = useCallback((): void => {
    terminateSession(websocketReference.current);
    onRemove();
  }, [onRemove]);

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
    if (!props.isExpanded) {
      return;
    }

    // Document-level escape hatch: an expanded terminal owns scrolling, so the host page must not scroll beneath it.
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
    const terminalContainer: HTMLDivElement | null = terminalContainerReference.current;
    const terminalViewport: HTMLDivElement | null = terminalViewportReference.current;
    const reportStatus = (status: TerminalSessionStatus, errorMessage: string | null = null): void => {
      onStatusChangeReference.current(status, errorMessage);
    };

    hasExitedReference.current = false;

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
      appendTerminalSessionParameters(websocketUrl, session.sessionId, controlToken).toString(),
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
        reportStatus("working");
        return true;
      }

      if (data === "SetAgentStatus=finished") {
        reportStatus("idle");
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
      reportStatus("running");
      scheduleTerminalResize();

      if (isExpandedReference.current) {
        terminal.focus();
      }
    };
    const handleClose = (): void => {
      if (!hasExitedReference.current) {
        reportStatus("disconnected");
      }
    };
    const handleError = (): void => {
      reportStatus("error", "The terminal websocket failed.");
    };
    const handleMessage = (event: MessageEvent<string>): void => {
      const message: TerminalSessionServerMessage | null = parseTerminalSessionServerMessage(event.data);

      if (message === null) {
        reportStatus("error", "Received an invalid terminal message.");
        return;
      }

      if (message.type === "snapshot" || message.type === "output") {
        terminal.write(message.data);
        return;
      }

      if (message.type === "exit") {
        hasExitedReference.current = true;
        reportStatus("exited");
        return;
      }

      reportStatus("error", message.message);
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
  }, [controlToken, scheduleTerminalResize, session.sessionId]);

  useEffect(() => {
    const terminal: Terminal | null = terminalReference.current;

    if (terminal === null) {
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
    }

    scheduleTerminalResize();
  }, [hasExited, props.isExpanded, scheduleTerminalResize, terminalTheme]);

  useEffect(() => {
    if (!shouldAutoRemoveTerminalSession(session, hasExited)) {
      return;
    }

    onRemove();
  }, [hasExited, onRemove, session]);

  const primaryAction = readTerminalSessionPrimaryAction(hasExited);

  return (
    <div className="contents" data-testid="TerminalSessionPanel">
      <div
        aria-hidden="true"
        className="devhost-fade pointer-events-auto fixed inset-0 z-(--devhost-z-modal) bg-backdrop"
        data-testid="TerminalSessionPanel--backdrop"
        hidden={!props.isExpanded || isFullscreen}
        onClick={props.onMinimize}
      />
      <section
        aria-label={`${session.summary.title} terminal`}
        className={cn(
          "devhost-fade pointer-events-auto fixed z-(--devhost-z-modal) grid overflow-hidden bg-card text-card-foreground",
          session.errorMessage === null ? "grid-rows-[auto_1fr]" : "grid-rows-[auto_auto_1fr]",
          isFullscreen
            ? "inset-0"
            : "top-1/2 left-1/2 h-[min(700px,calc(100vh-32px))] w-[min(1100px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-edge shadow-frame",
        )}
        data-testid="TerminalSessionPanel--content"
        hidden={!props.isExpanded}
        inert={!props.isExpanded}
        role="dialog"
      >
        <header
          className="flex h-6.5 min-w-0 items-center gap-1.5 border-b border-border pr-1 pl-2"
          data-testid="TerminalSessionPanel--header"
        >
          {session.kind === "editor" ? (
            <CodeIcon aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <TerminalIcon aria-hidden="true" className="size-3.5 shrink-0" />
          )}
          <strong className="shrink-0">{session.summary.title}</strong>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.summary.meta.join(" · ")}</span>
          <Badge variant={statusBadgeVariants[session.status]}>{readTerminalSessionStatusLabel(session.status)}</Badge>
          <Button
            aria-label="Minimize"
            startEnhancer={<MinusIcon />}
            testId="TerminalSessionPanel--minimize"
            title="Minimize to toolbar"
            onClick={props.onMinimize}
          />
          <Button
            startEnhancer={<XIcon />}
            testId={primaryAction.testId}
            title={primaryAction.title}
            variant={primaryAction.variant}
            onClick={discardSession}
          >
            {primaryAction.label}
          </Button>
        </header>
        {session.errorMessage === null ? null : (
          <InlineNotice testId="TerminalSessionPanel--error" tone="danger">
            {session.errorMessage}
          </InlineNotice>
        )}
        <div
          ref={terminalViewportReference}
          className="min-h-0 overflow-hidden bg-terminal px-2 py-1.5"
          data-testid="TerminalSessionPanel--terminal"
        >
          <div ref={terminalContainerReference} className="size-full" />
        </div>
      </section>
    </div>
  );
}

function appendTerminalSessionParameters(websocketUrl: URL, sessionId: string, controlToken: string): URL {
  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, controlToken);
  websocketUrl.searchParams.set(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME, sessionId);

  return websocketUrl;
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
