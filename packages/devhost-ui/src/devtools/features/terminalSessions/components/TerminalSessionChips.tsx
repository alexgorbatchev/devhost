import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { CheckIcon, CodeIcon, TerminalIcon, XIcon } from "lucide-react";

import { cn } from "../../../../lib/utils";

import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";
import { useToolbarPopoverId } from "../../../shared/hooks/useToolbarPopoverId";
import { pickVisibleTerminalSessions } from "../pickVisibleTerminalSessions";
import { readTerminalSessionStatusLabel } from "../readTerminalSessionStatusLabel";
import type { TerminalSession, TerminalSessionStatus } from "../types";

interface ITerminalSessionChipsProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: TerminalSession[];
}

const statusDotClassNames: Record<Exclude<TerminalSessionStatus, "exited">, string> = {
  connecting: "bg-faint",
  disconnected: "bg-destructive",
  error: "bg-destructive",
  idle: "bg-success",
  running: "animate-devhost-pulse bg-primary",
  working: "animate-devhost-pulse bg-primary",
};

/**
 * Toolbar segment with one chip per terminal session. The segment shrinks with the toolbar; chips that no longer
 * fit fold into a "+N" popover listing every session, so the toolbar never overflows the viewport.
 */
export function TerminalSessionChips(props: ITerminalSessionChipsProps): JSX.Element | null {
  const segmentReference = useRef<HTMLDivElement | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(Number.POSITIVE_INFINITY);
  const [viewportWidth, setViewportWidth] = useState<number>(() => window.innerWidth);
  const visibleSessions: TerminalSession[] = pickVisibleTerminalSessions(props.sessions, visibleLimit);
  const hiddenSessions: TerminalSession[] = props.sessions.filter(
    (session: TerminalSession): boolean => !visibleSessions.includes(session),
  );
  const fitKey: string = props.sessions
    .map((session: TerminalSession) => `${session.sessionId}:${session.status}`)
    .join();

  useEffect(() => {
    const handleResize = (): void => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Start from "everything visible" whenever the chip set or the viewport changes, then shrink below.
  useLayoutEffect(() => {
    setVisibleLimit(Number.POSITIVE_INFINITY);
  }, [fitKey, viewportWidth]);

  // Measure-and-shrink: drop one chip per layout pass until the segment content fits its available width.
  useLayoutEffect(() => {
    const segment: HTMLDivElement | null = segmentReference.current;

    if (segment === null || visibleSessions.length === 0 || segment.scrollWidth <= segment.clientWidth) {
      return;
    }

    setVisibleLimit(visibleSessions.length - 1);
  });

  if (props.sessions.length === 0) {
    return null;
  }

  return (
    <ToolbarSegment ariaLabel="Terminal sessions" layout="shrink" ref={segmentReference} testId="TerminalSessionChips">
      {visibleSessions.map((session: TerminalSession) => (
        <TerminalSessionChip
          key={session.sessionId}
          session={session}
          onRemove={(): void => props.onRemoveSession(session.sessionId)}
          onToggle={(): void => {
            if (session.isExpanded) {
              props.onMinimizeSession(session.sessionId);
              return;
            }

            props.onExpandSession(session.sessionId);
          }}
        />
      ))}
      {hiddenSessions.length > 0 ? (
        <ToolbarPopover
          panelLabel="Terminal sessions"
          panelWidth="md"
          testId="TerminalSessionChips--overflow"
          title="All terminal sessions"
          triggerAppearance="button"
          triggerContent={
            <>
              {hiddenSessions.some((session: TerminalSession): boolean => session.status !== "exited") ? (
                <TerminalSessionStatusIndicator status="running" />
              ) : null}
              <span aria-hidden="true">{`+${hiddenSessions.length}`}</span>
            </>
          }
          triggerLabel={`All terminal sessions (${hiddenSessions.length} more)`}
        >
          <TerminalSessionList
            sessions={props.sessions}
            onExpandSession={props.onExpandSession}
            onRemoveSession={props.onRemoveSession}
          />
        </ToolbarPopover>
      ) : null}
    </ToolbarSegment>
  );
}

interface ITerminalSessionChipProps {
  onRemove: () => void;
  onToggle: () => void;
  session: TerminalSession;
}

function TerminalSessionChip({ onRemove, onToggle, session }: ITerminalSessionChipProps): JSX.Element {
  const hasExited: boolean = session.status === "exited";
  const statusLabel: string = readTerminalSessionStatusLabel(session.status);

  return (
    <span className="flex shrink-0" data-testid="TerminalSessionChip">
      <button
        aria-label={`${session.summary.chipLabel} terminal, ${statusLabel}`}
        aria-pressed={session.isExpanded}
        className={cn(
          "flex h-5 max-w-45 items-center gap-1 rounded-sm border bg-secondary px-1.5 enabled:hover:border-faint enabled:hover:bg-accent",
          "aria-pressed:border-primary aria-pressed:shadow-[inset_0_0_0_1px_var(--primary)]",
          hasExited ? "rounded-r-none border-success" : "border-border",
        )}
        title={`${session.summary.title} · ${session.summary.meta[0] ?? ""} — ${statusLabel}`}
        type="button"
        onClick={onToggle}
      >
        <TerminalSessionStatusIndicator status={session.status} />
        <TerminalSessionKindIcon session={session} />
        <span className="truncate">{session.summary.chipLabel}</span>
      </button>
      {hasExited ? (
        <button
          aria-label={`Close ${session.summary.chipLabel} session`}
          className="grid h-5 w-5 place-items-center rounded-r-sm border border-l-0 border-success bg-secondary enabled:hover:bg-accent [&_svg]:size-3.5"
          title={`Close ${session.summary.chipLabel} session`}
          type="button"
          onClick={onRemove}
        >
          <XIcon aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}

interface ITerminalSessionListProps {
  onExpandSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: TerminalSession[];
}

function TerminalSessionList(props: ITerminalSessionListProps): JSX.Element {
  const popoverId: string | undefined = useToolbarPopoverId();

  return (
    <ul className="m-0 list-none p-0" data-testid="TerminalSessionChips--session-list">
      {props.sessions.map((session: TerminalSession) => {
        const hasExited: boolean = session.status === "exited";
        const detail: string = session.summary.meta
          .filter((entry: string): boolean => entry !== session.summary.chipLabel)
          .slice(0, 2)
          .join(" · ");

        return (
          <li
            key={session.sessionId}
            className="flex min-h-6 items-center gap-1.5 py-0.5 pr-1 pl-2 not-first:border-t hover:bg-secondary"
          >
            <TerminalSessionStatusIndicator status={session.status} />
            <span className="sr-only">{readTerminalSessionStatusLabel(session.status)}</span>
            <TerminalSessionKindIcon session={session} />
            {/* Picking a session closes the panel natively so the opened terminal is not covered by the top layer. */}
            <button
              aria-label={`Open ${session.summary.chipLabel} terminal`}
              aria-pressed={session.isExpanded}
              className="min-w-0 flex-1 truncate text-left hover:[&>strong]:text-primary hover:[&>strong]:underline aria-pressed:[&>strong]:text-primary"
              popoverTarget={popoverId}
              popoverTargetAction="hide"
              type="button"
              onClick={(): void => props.onExpandSession(session.sessionId)}
            >
              <strong>{session.summary.chipLabel}</strong> <span className="text-muted-foreground">{detail}</span>
            </button>
            {hasExited ? (
              <button
                aria-label={`Close ${session.summary.chipLabel} session`}
                className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
                type="button"
                onClick={(): void => props.onRemoveSession(session.sessionId)}
              >
                <XIcon aria-hidden="true" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

interface ITerminalSessionStatusIndicatorProps {
  status: TerminalSessionStatus;
}

function TerminalSessionStatusIndicator({ status }: ITerminalSessionStatusIndicatorProps): JSX.Element {
  if (status === "exited") {
    return <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />;
  }

  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", statusDotClassNames[status])} />;
}

interface ITerminalSessionKindIconProps {
  session: TerminalSession;
}

function TerminalSessionKindIcon({ session }: ITerminalSessionKindIconProps): JSX.Element {
  return session.kind === "editor" ? (
    <CodeIcon aria-hidden="true" className="size-3.5 shrink-0" />
  ) : (
    <TerminalIcon aria-hidden="true" className="size-3.5 shrink-0" />
  );
}
