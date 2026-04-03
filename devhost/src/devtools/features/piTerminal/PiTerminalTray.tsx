import type { JSX } from "preact";

import { css, useDevtoolsTheme } from "../../shared";
import { PiTerminalPanel } from "./PiTerminalPanel";
import type { ITerminalSession } from "./types";

interface IPiTerminalTrayProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: ITerminalSession[];
}

export function PiTerminalTray(props: IPiTerminalTrayProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const expandedSession: ITerminalSession | undefined = props.sessions.find((session: ITerminalSession): boolean => session.isExpanded);
  const minimizedSessions: ITerminalSession[] = props.sessions.filter((session: ITerminalSession): boolean => !session.isExpanded);

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
        <div class={dockClassName} data-testid="PiTerminalTray--dock">
          <div class={sessionListClassName} data-testid="PiTerminalTray--session-list">
            {minimizedSessions.map((session: ITerminalSession) => {
              return (
                <PiTerminalPanel
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
