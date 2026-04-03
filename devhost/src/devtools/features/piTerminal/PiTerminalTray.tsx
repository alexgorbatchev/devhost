import type { JSX } from "preact";

import { css, useDevtoolsTheme } from "../../shared";
import { PiTerminalPanel } from "./PiTerminalPanel";
import type { IPiTerminalSession } from "./types";

interface IPiTerminalTrayProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: IPiTerminalSession[];
}

export function PiTerminalTray(props: IPiTerminalTrayProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const expandedSession: IPiTerminalSession | undefined = props.sessions.find((session: IPiTerminalSession): boolean => session.isExpanded);
  const minimizedSessions: IPiTerminalSession[] = props.sessions.filter((session: IPiTerminalSession): boolean => !session.isExpanded);

  if (expandedSession === undefined && minimizedSessions.length === 0) {
    return null;
  }

  const dockClassName: string = css({
    bottom: theme.spacing.sm,
    display: "flex",
    justifyContent: "center",
    left: theme.spacing.sm,
    pointerEvents: "none",
    position: "fixed",
    right: theme.spacing.sm,
    zIndex: theme.zIndices.floating,
  });
  const rootClassName: string = css({
    inset: 0,
    pointerEvents: "none",
    position: "fixed",
    zIndex: theme.zIndices.floating,
  });
  const sessionListClassName: string = css({
    alignItems: "flex-end",
    display: "flex",
    gap: theme.spacing.sm,
    maxWidth: "100%",
    overflowX: "auto",
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    pointerEvents: "auto",
  });

  return (
    <div class={rootClassName} data-testid="PiTerminalTray">
      {expandedSession !== undefined ? (
        <PiTerminalPanel
          annotation={expandedSession.annotation}
          isExpanded={true}
          sessionId={expandedSession.sessionId}
          onExpand={noop}
          onMinimize={(): void => {
            props.onMinimizeSession(expandedSession.sessionId);
          }}
          onRemove={(): void => {
            props.onRemoveSession(expandedSession.sessionId);
          }}
        />
      ) : null}
      {minimizedSessions.length > 0 ? (
        <div class={dockClassName} data-testid="PiTerminalTray--dock">
          <div class={sessionListClassName} data-testid="PiTerminalTray--session-list">
            {minimizedSessions.map((session: IPiTerminalSession) => {
              return (
                <PiTerminalPanel
                  key={session.sessionId}
                  annotation={session.annotation}
                  isExpanded={false}
                  sessionId={session.sessionId}
                  onExpand={(): void => {
                    props.onExpandSession(session.sessionId);
                  }}
                  onMinimize={noop}
                  onRemove={(): void => {
                    props.onRemoveSession(session.sessionId);
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function noop(): void {}
