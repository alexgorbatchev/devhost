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
  const expandedRootClassName: string = css({
    inset: 0,
    pointerEvents: "none",
    position: "fixed",
    zIndex: theme.zIndices.terminalExpanded,
  });
  const trayRootClassName: string = css({
    inset: 0,
    pointerEvents: "none",
    position: "fixed",
    zIndex: theme.zIndices.terminalTray,
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
    <div data-testid="TerminalSessionTray">
      {expandedSession !== undefined ? (
        <div class={expandedRootClassName} data-testid="TerminalSessionTray--expanded-root">
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
        </div>
      ) : null}
      {minimizedSessions.length > 0 ? (
        <div class={trayRootClassName} data-testid="TerminalSessionTray--tray-root">
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
        </div>
      ) : null}
    </div>
  );
}

function noop(): void {}
