import type { JSX } from "preact";

import { css, useDevtoolsTheme } from "../../shared";
import { TerminalSessionPanel } from "./TerminalSessionPanel";
import type { TerminalSession } from "./types";

interface ITerminalSessionTrayProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: TerminalSession[];
}

export function TerminalSessionTray(props: ITerminalSessionTrayProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const expandedSession: TerminalSession | undefined = props.sessions.find(
    (session: TerminalSession): boolean => session.isExpanded,
  );
  const minimizedSessions: TerminalSession[] = props.sessions.filter(
    (session: TerminalSession): boolean => !session.isExpanded,
  );

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
    <div class={rootClassName} data-testid="TerminalSessionTray">
      {expandedSession !== undefined ? (
        <TerminalSessionPanel
          isExpanded={true}
          session={expandedSession}
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
        <div class={dockClassName} data-testid="TerminalSessionTray--dock">
          <div class={sessionListClassName} data-testid="TerminalSessionTray--session-list">
            {minimizedSessions.map((session: TerminalSession) => {
              return (
                <TerminalSessionPanel
                  key={session.sessionId}
                  isExpanded={false}
                  session={session}
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
