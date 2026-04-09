import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

import { Button, css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import { createDevtoolsWebSocketUrl } from "../../shared/createDevtoolsWebSocketUrl";
import {
  DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME,
  TERMINAL_SESSION_WEBSOCKET_PATH,
  XTERM_STYLESHEET_PATH,
} from "../../shared/constants";
import { readDevtoolsControlToken } from "../../shared/readDevtoolsControlToken";
import { createXtermTheme } from "./createXtermTheme";
import { readTerminalSessionPrimaryAction } from "./readTerminalSessionPrimaryAction";
import { resolveTerminalPanelLayout, type IPanelSize } from "./resolveTerminalPanelLayout";
import { shouldAutoRemoveTerminalSession } from "./shouldAutoRemoveTerminalSession";
import type {
  TerminalSession,
  ITerminalSessionSummary,
  TerminalSessionClientMessage,
  TerminalSessionServerMessage,
} from "./types";

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

const normalClosureCode: number = 1000;
const trayScale: number = 0.32;
const trayTransitionDurationInMilliseconds: number = 180;
const xtermStylesheetId: string = "devhost-xterm-stylesheet";

export function TerminalSessionPanel(props: ITerminalSessionPanelProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const fitAddonReference = useRef<FitAddon | null>(null);
  const hasExitedReference = useRef<boolean>(false);
  const resizeAnimationFrameReference = useRef<number | null>(null);
  const terminalContainerReference = useRef<HTMLDivElement | null>(null);
  const terminalReference = useRef<Terminal | null>(null);
  const terminalViewportReference = useRef<HTMLDivElement | null>(null);
  const themeReference = useRef<IDevtoolsTheme>(theme);
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

  themeReference.current = theme;
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

    const currentTheme: IDevtoolsTheme = themeReference.current;
    const terminal = new Terminal({
      allowTransparency: true,
      cols: 120,
      cursorBlink: true,
      disableStdin: !isExpandedReference.current,
      fontFamily: currentTheme.fontFamilies.monospace,
      fontSize: Number.parseInt(currentTheme.fontSizes.md, 10),
      rows: 80,
      scrollback: 2_000,
      theme: createXtermTheme(currentTheme),
    });
    const fitAddon = new FitAddon();
    const websocketUrl: URL = new URL(createDevtoolsWebSocketUrl(TERMINAL_SESSION_WEBSOCKET_PATH, window.location));
    const websocket = new WebSocket(appendTerminalSessionParameters(websocketUrl, props.session.sessionId).toString());

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
      setStatusText("Working…");
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
  }, [props.session.sessionId, scheduleTerminalResize]);

  useEffect(() => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const websocket: WebSocket | null = websocketReference.current;

    if (fitAddon === null || terminal === null || websocket === null) {
      return;
    }

    terminal.options.disableStdin = !props.isExpanded || hasExited;
    terminal.options.theme = createXtermTheme(theme);
    terminal.options.fontFamily = theme.fontFamilies.monospace;
    terminal.options.fontSize = Number.parseInt(theme.fontSizes.md, 10);

    if (props.isExpanded && !hasExited) {
      terminal.focus();
    } else {
      terminal.blur();
      setIsTrayHoverVisible(false);
    }

    scheduleTerminalResize();
  }, [activePanelSize.height, activePanelSize.width, hasExited, props.isExpanded, scheduleTerminalResize, theme]);

  useEffect(() => {
    if (!shouldAutoRemoveTerminalSession(session, hasExited)) {
      return;
    }

    onRemove();
  }, [hasExited, onRemove, session]);

  const primaryAction = readTerminalSessionPrimaryAction(hasExited);
  const sessionSummary: ITerminalSessionSummary = props.session.summary;
  const summaryClassName: string = css(createSummaryStyle(theme));
  const compactSummaryClassName: string = css(createCompactSummaryStyle(theme));
  const compactSummaryPathClassName: string = css(createCompactSummaryPathStyle(theme));
  const summaryHeadlineClassName: string = css(createSummaryHeadlineStyle(theme));
  const summaryEyebrowClassName: string = css(createSummaryEyebrowStyle(theme));
  const summaryMetaClassName: string = css(createSummaryMetaStyle(theme));
  const buttonGroupClassName: string = css(buttonGroupStyle);
  const chromeClassName: string = css(
    createChromeStyle(theme, activePanelSize, terminalPanelLayout.isFullscreenExpanded && props.isExpanded),
  );
  const backdropClassName: string = css(createBackdropStyle(theme));
  const expandedOverlayClassName: string = css(createExpandedOverlayStyle(theme));
  const expandedPanelClassName: string = css(
    createExpandedPanelStyle(activePanelSize, terminalPanelLayout.isFullscreenExpanded),
  );
  const headerClassName: string = css(createHeaderStyle(theme));
  const headerTextClassName: string = css(headerTextStyle);
  const statusClassName: string = css(createStatusStyle(theme, errorMessage !== null));
  const terminalContainerClassName: string = css(terminalContainerStyle);
  const terminalViewportClassName: string = css(createTerminalViewportStyle(theme));
  const trayBadgeClassName: string = css(createTrayBadgeStyle(theme));
  const trayCompletionIconClassName: string = css(createTrayCompletionIconStyle(theme));
  const trayCloseButtonClassName: string = css(createTrayCloseButtonStyle(theme));
  const trayCloseIconClassName: string = css(createTrayCloseIconStyle(theme));
  const trayCompletionOverlayClassName: string = css(createTrayCompletionOverlayStyle());
  const trayOverlayButtonClassName: string = css(createTrayOverlayButtonStyle(theme));
  const trayScaledContentClassName: string = css(createTrayScaledContentStyle(terminalPanelLayout.trayPanelSize));
  const trayShellClassName: string = css(createTrayShellStyle(theme, terminalPanelLayout.trayPanelSize, isTrayMounted));
  const trayTooltipClassName: string = css(createTrayTooltipStyle(theme, trayTooltipLayout));
  const trayTooltipCommentClassName: string = css(createTrayTooltipCommentStyle(theme));
  const trayTooltipMetaClassName: string = css(createTrayTooltipMetaStyle(theme));

  const panelContent: JSX.Element = (
    <div class={chromeClassName}>
      <header class={headerClassName} data-testid="TerminalSessionPanel--header">
        <div class={headerTextClassName}>
          <strong>{sessionSummary.terminalTitle}</strong>
          <span class={statusClassName}>{errorMessage ?? statusText}</span>
        </div>
        {props.isExpanded ? (
          <div class={buttonGroupClassName}>
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
          <section class={compactSummaryClassName} data-testid="TerminalSessionPanel--summary">
            <strong class={summaryHeadlineClassName}>{sessionSummary.headline}</strong>
            <span class={compactSummaryPathClassName}>{sessionSummary.meta[0]}</span>
          </section>
        ) : (
          <section class={summaryClassName} data-testid="TerminalSessionPanel--summary">
            <span class={summaryEyebrowClassName}>{sessionSummary.eyebrow}</span>
            <strong class={summaryHeadlineClassName}>{sessionSummary.headline}</strong>
            <div class={summaryMetaClassName}>
              {sessionSummary.meta.map((entry: string) => {
                return <span key={entry}>{entry}</span>;
              })}
            </div>
          </section>
        )
      ) : null}
      <div
        ref={terminalViewportReference}
        class={terminalViewportClassName}
        data-testid="TerminalSessionPanel--terminal"
      >
        <div ref={terminalContainerReference} class={terminalContainerClassName} />
      </div>
    </div>
  );

  if (props.isExpanded) {
    return (
      <div class={expandedOverlayClassName} data-testid="TerminalSessionPanel">
        <div aria-hidden="true" class={backdropClassName} data-testid="TerminalSessionPanel--backdrop" />
        <section class={expandedPanelClassName} data-testid="TerminalSessionPanel--content">
          {panelContent}
        </section>
      </div>
    );
  }

  return (
    <section
      ref={trayShellReference}
      class={trayShellClassName}
      data-testid="TerminalSessionPanel"
      onMouseEnter={(): void => {
        updateTrayTooltipLayout();
        setIsTrayHoverVisible(true);
      }}
      onMouseLeave={(): void => {
        setIsTrayHoverVisible(false);
      }}
    >
      <div class={trayScaledContentClassName}>{panelContent}</div>
      <button
        aria-label={`Expand ${sessionSummary.terminalTitle} preview`}
        class={trayOverlayButtonClassName}
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
        <span class={trayBadgeClassName}>{errorMessage ?? statusText}</span>
      </button>
      {hasExited && !isTrayHoverVisible ? (
        <div
          aria-hidden="true"
          class={trayCompletionOverlayClassName}
          data-testid="TerminalSessionPanel--completion-indicator"
        >
          <svg class={trayCompletionIconClassName} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
            <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM369 209L241 337c-9.4 9.4-24.6 9.4-33.9 0l-64-64c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l47 47L335 175c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9z" />
          </svg>
        </div>
      ) : null}
      {hasExited && isTrayHoverVisible ? (
        <button
          aria-label="Close terminal session"
          class={trayCloseButtonClassName}
          data-testid="TerminalSessionPanel--tray-close"
          title="Close terminal session"
          type="button"
          onClick={(event: JSX.TargetedMouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation();
            discardSession();
          }}
        >
          <svg
            class={trayCloseIconClassName}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z" />
          </svg>
        </button>
      ) : null}
      {isTrayHoverVisible && trayTooltipLayout !== null ? (
        <div class={trayTooltipClassName} data-testid="TerminalSessionPanel--tooltip">
          <strong class={trayTooltipCommentClassName}>{sessionSummary.trayTooltipPrimary}</strong>
          {sessionSummary.trayTooltipSecondary !== undefined ? (
            <span class={trayTooltipMetaClassName}>{sessionSummary.trayTooltipSecondary}</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function appendTerminalSessionParameters(websocketUrl: URL, sessionId: string): URL {
  websocketUrl.searchParams.set(DEVTOOLS_CONTROL_TOKEN_QUERY_PARAMETER_NAME, readDevtoolsControlToken());
  websocketUrl.searchParams.set(TERMINAL_SESSION_ID_QUERY_PARAMETER_NAME, sessionId);

  return websocketUrl;
}

function createCompactSummaryStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    background: theme.colors.selectionBackground,
    border: `1px solid ${theme.colors.selectionBorder}`,
    borderRadius: theme.radii.sm,
    display: "flex",
    gap: theme.spacing.sm,
    minWidth: 0,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  };
}

function createCompactSummaryPathStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    flex: "1 1 auto",
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function createSummaryHeadlineStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    flex: "0 0 auto",
    fontSize: theme.fontSizes.lg,
    lineHeight: 1.45,
  };
}

function createSummaryEyebrowStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  };
}

function createSummaryMetaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createSummaryStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.selectionBorder}`,
    borderRadius: theme.radii.sm,
    background: theme.colors.selectionBackground,
  };
}

function createBackdropStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    position: "fixed",
    inset: 0,
    background: theme.colors.backdrop,
    pointerEvents: "auto",
  };
}

function createChromeStyle(theme: IDevtoolsTheme, panelSize: IPanelSize, isFullscreen: boolean): CSSObject {
  return {
    width: `${panelSize.width}px`,
    height: `${panelSize.height}px`,
    display: "grid",
    gridTemplateRows: "auto auto 1fr",
    gap: theme.spacing.sm,
    padding: theme.spacing.sm,
    boxSizing: "border-box",
    border: isFullscreen ? "none" : `1px solid ${theme.colors.border}`,
    borderRadius: isFullscreen ? "0px" : theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    boxShadow: isFullscreen ? "none" : theme.shadows.popup,
  };
}

function createExpandedOverlayStyle(_theme: IDevtoolsTheme): CSSObject {
  return {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: 3,
  };
}

function createExpandedPanelStyle(panelSize: IPanelSize, isFullscreen: boolean): CSSObject {
  return {
    position: "fixed",
    top: isFullscreen ? "0px" : "50%",
    left: isFullscreen ? "0px" : "50%",
    width: `${panelSize.width}px`,
    height: `${panelSize.height}px`,
    transform: isFullscreen ? "none" : "translate(-50%, -50%)",
    pointerEvents: "auto",
    zIndex: 1,
  };
}

function createExitStatusText(_exitCode: number | null, _signalCode: string | null): string {
  return "Finished";
}

function createHeaderStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  };
}

function createStatusStyle(theme: IDevtoolsTheme, isError: boolean): CSSObject {
  return {
    color: isError ? theme.colors.dangerForeground : theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
  };
}

function createTerminalViewportStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    minHeight: 0,
    overflow: "hidden",
    background: theme.colors.background,
  };
}

function createTrayBadgeStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    position: "absolute",
    left: theme.spacing.xs,
    right: theme.spacing.xs,
    bottom: theme.spacing.xs,
    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
    borderRadius: theme.radii.md,
    background: theme.colors.logMinimapOverlayBackground,
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.sm,
    textAlign: "left",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  };
}

function createTrayCompletionIconStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    width: "24px",
    height: "24px",
    display: "block",
    color: theme.colors.successBackground,
    fill: "currentColor",
    filter: `drop-shadow(0px 2px 6px ${theme.colors.successGlow})`,
  };
}

function createTrayCloseButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    appearance: "none",
    background: "transparent",
    border: "none",
    color: theme.colors.successBackground,
    cursor: "pointer",
    display: "grid",
    height: "24px",
    inset: 0,
    justifyItems: "center",
    margin: "auto",
    padding: 0,
    position: "absolute",
    transition: "color 120ms ease",
    width: "24px",
    zIndex: 2,
    "& svg": {
      filter: `drop-shadow(0px 2px 6px ${theme.colors.successGlow})`,
      transition: "filter 120ms ease",
    },
    "&:is(:hover, :focus-visible)": {
      color: theme.colors.dangerForeground,
      outline: "none",
    },
    "&:is(:hover, :focus-visible) svg": {
      filter: `drop-shadow(0px 2px 6px ${theme.colors.dangerGlow})`,
    },
  };
}

function createTrayCloseIconStyle(_theme: IDevtoolsTheme): CSSObject {
  return {
    display: "block",
    fill: "currentColor",
    height: "24px",
    width: "24px",
  };
}

function createTrayCompletionOverlayStyle(): CSSObject {
  return {
    position: "absolute",
    inset: 0,
    display: "grid",
    placeItems: "center",
    pointerEvents: "none",
    zIndex: 1,
  };
}

function createTrayOverlayButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    position: "absolute",
    inset: 0,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: "transparent",
    cursor: "pointer",
  };
}

function createTrayScaledContentStyle(panelSize: IPanelSize): CSSObject {
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

function createTrayShellStyle(_theme: IDevtoolsTheme, panelSize: IPanelSize, isTrayMounted: boolean): CSSObject {
  return {
    position: "relative",
    flex: "0 0 auto",
    width: isTrayMounted ? `${panelSize.width * trayScale}px` : "0px",
    height: `${panelSize.height * trayScale}px`,
    opacity: isTrayMounted ? 1 : 0,
    transition: [
      `width ${trayTransitionDurationInMilliseconds}ms ease`,
      `opacity ${trayTransitionDurationInMilliseconds}ms ease`,
    ].join(", "),
    pointerEvents: "auto",
    overflow: "visible",
    zIndex: 1,
  };
}

function createTrayTooltipCommentStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.foreground,
    lineHeight: 1.45,
  };
}

function createTrayTooltipMetaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
  };
}

function createTrayTooltipStyle(theme: IDevtoolsTheme, trayTooltipLayout: ITrayTooltipLayout | null): CSSObject {
  if (trayTooltipLayout === null) {
    return {
      display: "none",
    };
  }

  return {
    position: "fixed",
    left: `${trayTooltipLayout.left}px`,
    bottom: `${trayTooltipLayout.bottom}px`,
    width: `${trayTooltipLayout.width}px`,
    display: "grid",
    gap: theme.spacing.xxs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    boxShadow: theme.shadows.popup,
    zIndex: 2,
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

const buttonGroupStyle: CSSObject = {
  display: "flex",
  gap: "8px",
};

const headerTextStyle: CSSObject = {
  display: "grid",
};

const terminalContainerStyle: CSSObject = {
  width: "100%",
  height: "100%",
};
