import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { CheckIcon, CodeIcon, TerminalIcon, XIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";

import { cn } from "../../../../lib/utils";

import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";
import { useToolbarPopoverId } from "../../../shared/hooks/useToolbarPopoverId";
import { fitTerminalSessionChips } from "../fitTerminalSessionChips";
import { pickVisibleTerminalSessions } from "../pickVisibleTerminalSessions";
import { readTerminalSessionStatusLabel } from "../readTerminalSessionStatusLabel";
import type {
  ITerminalSessionChipFailedFit,
  ITerminalSessionChipFit,
  TerminalSession,
  TerminalSessionStatus,
} from "../types";

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
 * fit fold into a "+N" popover listing every session, so the toolbar never overflows the viewport. Folded chips
 * come back as soon as the toolbar has room for them again.
 */
export function TerminalSessionChips(props: ITerminalSessionChipsProps): JSX.Element | null {
  const segmentReference = useRef<HTMLDivElement | null>(null);
  const overflowReference = useRef<HTMLButtonElement | null>(null);
  const foldedChipsReference = useRef<HTMLSpanElement | null>(null);
  const failedFitReference = useRef<ITerminalSessionChipFailedFit | null>(null);
  const [visibleLimit, setVisibleLimit] = useState<number>(Number.POSITIVE_INFINITY);
  const [, setFitRequestCount] = useState<number>(0);
  const hasSessions: boolean = props.sessions.length > 0;
  const visibleSessions: TerminalSession[] = pickVisibleTerminalSessions(props.sessions, visibleLimit);
  const hiddenSessions: TerminalSession[] = props.sessions.filter(
    (session: TerminalSession): boolean => !visibleSessions.includes(session),
  );
  const fitKey: string = props.sessions
    .map((session: TerminalSession) => `${session.sessionId}:${session.status}`)
    .join();

  // The room changes without rendering anything here: a neighbouring segment grows or shrinks, or the viewport
  // does. Each such change asks for another fit. The segment exists only while there are sessions.
  useEffect(() => {
    const segment: HTMLDivElement | null = segmentReference.current;

    if (segment === null) {
      return;
    }

    const requestFit = (): void => {
      setFitRequestCount((fitRequestCount: number): number => fitRequestCount + 1);
    };
    const resizeObserver = new ResizeObserver(requestFit);

    resizeObserver.observe(segment);
    if (segment.parentElement !== null) {
      resizeObserver.observe(segment.parentElement);
    }
    window.addEventListener("resize", requestFit);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", requestFit);
    };
  }, [hasSessions]);

  // Fit after every render, one chip per layout pass and before the browser paints. The popover stays mounted
  // throughout, so an open list of sessions stays open.
  useLayoutEffect(() => {
    const segment: HTMLDivElement | null = segmentReference.current;

    if (segment === null) {
      return;
    }

    const nextSessionIndex: number = hiddenSessions.findIndex((session: TerminalSession): boolean => {
      return pickVisibleTerminalSessions(props.sessions, visibleSessions.length + 1).includes(session);
    });
    const nextChip: Element | undefined = foldedChipsReference.current?.children[nextSessionIndex];
    const fit: ITerminalSessionChipFit = fitTerminalSessionChips(
      {
        contentWidth: segment.scrollWidth,
        fitKey,
        gapWidth: Number.parseFloat(getComputedStyle(segment).columnGap) || 0,
        hiddenCount: hiddenSessions.length,
        nextChipWidth: nextChip?.getBoundingClientRect().width ?? null,
        overflowWidth: overflowReference.current?.getBoundingClientRect().width ?? 0,
        room: readAvailableWidth(segment),
        visibleCount: visibleSessions.length,
      },
      failedFitReference.current,
    );

    failedFitReference.current = fit.failedFit;
    if (fit.visibleLimit !== visibleSessions.length) {
      setVisibleLimit(fit.visibleLimit);
    }
  });

  if (!hasSessions) {
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
          triggerReference={overflowReference}
        >
          <TerminalSessionList
            sessions={props.sessions}
            onExpandSession={props.onExpandSession}
            onRemoveSession={props.onRemoveSession}
          />
        </ToolbarPopover>
      ) : null}
      {/* Folded chips are laid out where nobody sees or reaches them, so the fit knows how wide each one is. */}
      <span ref={foldedChipsReference} aria-hidden="true" className="invisible absolute flex" inert>
        {hiddenSessions.map((session: TerminalSession) => (
          <TerminalSessionChip key={session.sessionId} isFolded session={session} onRemove={ignore} onToggle={ignore} />
        ))}
      </span>
    </ToolbarSegment>
  );
}

interface ITerminalSessionChipProps {
  /** A folded chip is rendered only to be measured. */
  isFolded?: boolean;
  onRemove: () => void;
  onToggle: () => void;
  session: TerminalSession;
}

function TerminalSessionChip({
  isFolded = false,
  onRemove,
  onToggle,
  session,
}: ITerminalSessionChipProps): JSX.Element {
  const hasExited: boolean = session.status === "exited";
  const statusLabel: string = readTerminalSessionStatusLabel(session.status);

  return (
    <span className="flex shrink-0" data-testid={isFolded ? undefined : "TerminalSessionChip"}>
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
          className="grid h-5 w-5 place-items-center rounded-r-sm border border-l-0 border-success bg-secondary enabled:hover:bg-accent"
          title={`Close ${session.summary.chipLabel} session`}
          type="button"
          onClick={onRemove}
        >
          <Icon glyph={XIcon} />
          <span className="sr-only">{`Close ${session.summary.chipLabel} session`}</span>
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
    <ul className="m-0 list-none p-0" data-testid="TerminalSessionList">
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
              className="group min-w-0 flex-1 truncate text-left"
              popoverTarget={popoverId}
              popoverTargetAction="hide"
              type="button"
              onClick={(): void => props.onExpandSession(session.sessionId)}
            >
              <strong className="group-hover:text-primary group-hover:underline group-aria-pressed:text-primary">
                {session.summary.chipLabel}
              </strong>{" "}
              <span className="text-muted-foreground">{detail}</span>
            </button>
            {hasExited ? (
              <button
                className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                type="button"
                onClick={(): void => props.onRemoveSession(session.sessionId)}
              >
                <Icon glyph={XIcon} />
                <span className="sr-only">{`Close ${session.summary.chipLabel} session`}</span>
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
    return <Icon glyph={CheckIcon} tone="success" />;
  }

  return <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", statusDotClassNames[status])} />;
}

interface ITerminalSessionKindIconProps {
  session: TerminalSession;
}

function TerminalSessionKindIcon({ session }: ITerminalSessionKindIconProps): JSX.Element {
  return session.kind === "editor" ? <Icon glyph={CodeIcon} /> : <Icon glyph={TerminalIcon} />;
}

function ignore(): void {}

/**
 * The width the toolbar can give the segment. A segment that wants more than there is gets exactly what is left,
 * so the layout answers for every limit above it: the viewport, the minimap, and the neighbouring segments.
 */
function readAvailableWidth(segment: HTMLElement): number {
  const width: string = segment.style.width;

  // A width, unlike a flex basis, also counts towards the width the toolbar itself asks for.
  segment.style.width = "100vw";

  const availableWidth: number = segment.clientWidth;

  segment.style.width = width;

  return availableWidth;
}
