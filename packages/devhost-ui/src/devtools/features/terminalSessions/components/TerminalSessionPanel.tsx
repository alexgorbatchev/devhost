import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { CodeIcon, MinusIcon, TerminalIcon, XIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";

import { Button, InlineNotice, useDevtoolsColorScheme } from "../../../shared";
import { pristineFetch } from "../../../shared/pristineFetch";
import { XTERM_STYLESHEET_PATH } from "../../../shared/constants";
import { openTerminalSessionStream, type ITerminalSessionStream } from "../openTerminalSessionStream";
import { readTerminalSessionPrimaryAction } from "../readTerminalSessionPrimaryAction";
import { readTerminalSessionStatusLabel } from "../readTerminalSessionStatusLabel";
import { readTerminalTheme, type ITerminalTheme } from "../readTerminalTheme";
import { shouldAutoRemoveTerminalSession } from "../shouldAutoRemoveTerminalSession";
import type { TerminalSession, TerminalSessionStatus } from "../types";

interface ITerminalSessionPanelProps {
  isExpanded: boolean;
  /** A fullscreen window leaves the collapsed minimap strip uncovered so the minimap stays usable beside it. */
  isMinimapVisible: boolean;
  onMinimize: () => void;
  onRemove: () => void;
  onStatusChange: (status: TerminalSessionStatus, errorMessage: string | null) => void;
  session: TerminalSession;
}

type StatusBadgeVariant = "default" | "destructive" | "primary" | "success";
type DisposeTerminal = () => void;

const statusBadgeVariants: Record<TerminalSessionStatus, StatusBadgeVariant> = {
  connecting: "default",
  disconnected: "destructive",
  error: "destructive",
  exited: "success",
  idle: "success",
  running: "primary",
  working: "primary",
};

const xtermStylesheetId: string = "devhost-xterm-stylesheet";

// The escape sequence for a full terminal reset (RIS). Written ahead of a snapshot it clears the screen and the
// scrollback in order with the output around it.
const terminalResetSequence: string = "\u001bc";

/**
 * One terminal session window. It stays mounted (hidden) while minimized so the session stream and xterm buffer
 * persist and the session keeps reporting status to its toolbar chip; expanding only reveals it.
 */
export function TerminalSessionPanel(props: ITerminalSessionPanelProps): JSX.Element {
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
  const streamReference = useRef<ITerminalSessionStream | null>(null);
  const { onRemove, session } = props;
  const hasExited: boolean = session.status === "exited";
  const isFullscreen: boolean = session.behavior.isFullscreenExpanded;

  terminalThemeReference.current = terminalTheme;
  isExpandedReference.current = props.isExpanded;
  onStatusChangeReference.current = props.onStatusChange;

  const discardSession = useCallback((): void => {
    streamReference.current?.send({ type: "close" });
    onRemove();
  }, [onRemove]);

  const scheduleTerminalResize = useCallback((): void => {
    const fitAddon: FitAddon | null = fitAddonReference.current;
    const terminal: Terminal | null = terminalReference.current;
    const stream: ITerminalSessionStream | null = streamReference.current;

    if (hasExitedReference.current || fitAddon === null || terminal === null || stream === null) {
      return;
    }

    if (resizeAnimationFrameReference.current !== null) {
      return;
    }

    resizeAnimationFrameReference.current = window.requestAnimationFrame((): void => {
      resizeAnimationFrameReference.current = null;
      resizeTerminal(terminal, fitAddon, stream);
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

    let isDisposed: boolean = false;
    let dispose: DisposeTerminal | undefined;
    const initializeTerminal = async (): Promise<void> => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (isDisposed) return;
      ensureXtermStylesheet(terminalContainer.getRootNode());

      const currentTheme: ITerminalTheme = terminalThemeReference.current;
      const terminal = new Terminal({
        allowTransparency: true,
        cols: 120,
        cursorBlink: true,
        disableStdin: !isExpandedReference.current,
        fontFamily: currentTheme.fontFamily,
        fontSize: currentTheme.fontSize,
        minimumContrastRatio: currentTheme.minimumContrastRatio,
        rows: 80,
        scrollback: 2_000,
        theme: currentTheme.theme,
      });
      const fitAddon = new FitAddon();
      const stream: ITerminalSessionStream = openTerminalSessionStream({
        fetch: pristineFetch,
        location: window.location,
        onOpen: (): void => {
          scheduleTerminalResize();

          if (isExpandedReference.current) {
            terminal.focus();
          }
        },
        onOutput: (data: string): void => {
          terminal.write(data);
        },
        // A reattached session sends its output again, so the snapshot replaces what the terminal shows.
        onSnapshot: (data: string): void => {
          terminal.write(`${terminalResetSequence}${data}`);
        },
        onStatusChange: (status: TerminalSessionStatus, errorMessage: string | null): void => {
          if (status === "exited") {
            hasExitedReference.current = true;
          }

          reportStatus(status, errorMessage);
        },
        sessionId: session.sessionId,
      });

      fitAddonReference.current = fitAddon;
      terminalReference.current = terminal;
      streamReference.current = stream;

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
        stream.send({ data, type: "input" });
      });
      dispose = () => {
        resizeObserver.disconnect();
        dataListener.dispose();
        oscListener.dispose();

        if (resizeAnimationFrameReference.current !== null) {
          window.cancelAnimationFrame(resizeAnimationFrameReference.current);
          resizeAnimationFrameReference.current = null;
        }

        stream.close();
        terminal.dispose();
        fitAddonReference.current = null;
        terminalReference.current = null;
        streamReference.current = null;
      };
      terminal.loadAddon(fitAddon);
      terminal.open(terminalContainer);
      resizeObserver.observe(terminalViewport);
      scheduleTerminalResize();
    };
    void initializeTerminal().catch((error: unknown): void => {
      dispose?.();
      if (!isDisposed) reportStatus("error", error instanceof Error ? error.message : "Failed to load the terminal.");
    });
    return () => {
      isDisposed = true;
      dispose?.();
    };
  }, [scheduleTerminalResize, session.sessionId]);

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
            ? cn("inset-y-0 left-0", props.isMinimapVisible ? "right-(--devhost-minimap-collapsed-width)" : "right-0")
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
          {session.kind === "editor" ? <Icon glyph={CodeIcon} /> : <Icon glyph={TerminalIcon} />}
          <strong className="shrink-0">{session.summary.title}</strong>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{session.summary.meta.join(" · ")}</span>
          <Badge variant={statusBadgeVariants[session.status]}>{readTerminalSessionStatusLabel(session.status)}</Badge>
          <Button
            startEnhancer={<Icon glyph={MinusIcon} />}
            testId="TerminalSessionPanel--minimize"
            title="Minimize to toolbar"
            onClick={props.onMinimize}
          >
            Minimize
          </Button>
          <Button
            startEnhancer={<Icon glyph={XIcon} />}
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

function resizeTerminal(terminal: Terminal, fitAddon: FitAddon, stream: ITerminalSessionStream): void {
  fitAddon.fit();

  if (terminal.cols === 0 || terminal.rows === 0) {
    return;
  }

  stream.send({ cols: terminal.cols, rows: terminal.rows, type: "resize" });
}
