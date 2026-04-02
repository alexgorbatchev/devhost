import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";

import { css, type IDevtoolsTheme } from "../../shared";
import { DevtoolsPiTerminalPanel } from "./DevtoolsPiTerminalPanel";
import type { IPiTerminalSession } from "./types";

interface IDevtoolsPiTerminalTrayProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: IPiTerminalSession[];
  theme: IDevtoolsTheme;
}

export function DevtoolsPiTerminalTray(props: IDevtoolsPiTerminalTrayProps): JSX.Element | null {
  const expandedSession: IPiTerminalSession | undefined = props.sessions.find((session: IPiTerminalSession): boolean => session.isExpanded);
  const minimizedSessions: IPiTerminalSession[] = props.sessions.filter((session: IPiTerminalSession): boolean => !session.isExpanded);

  if (expandedSession === undefined && minimizedSessions.length === 0) {
    return null;
  }

  const dockClassName: string = css(createDockStyle(props.theme));
  const rootClassName: string = css(createRootStyle(props.theme));
  const sessionListClassName: string = css(createSessionListStyle(props.theme));

  return (
    <div class={rootClassName} data-testid="DevtoolsPiTerminalTray">
      {expandedSession !== undefined ? (
        <DevtoolsPiTerminalPanel
          annotation={expandedSession.annotation}
          isExpanded={true}
          sessionId={expandedSession.sessionId}
          theme={props.theme}
          onExpand={noop}
          onMinimize={(): void => {
            props.onMinimizeSession(expandedSession.sessionId);
          }}
          onTerminate={(): void => {
            props.onRemoveSession(expandedSession.sessionId);
          }}
        />
      ) : null}
      {minimizedSessions.length > 0 ? (
        <div class={dockClassName} data-testid="DevtoolsPiTerminalTray--dock">
          <div class={sessionListClassName} data-testid="DevtoolsPiTerminalTray--session-list">
            {minimizedSessions.map((session: IPiTerminalSession) => {
              return (
                <DevtoolsPiTerminalPanel
                  key={session.sessionId}
                  annotation={session.annotation}
                  isExpanded={false}
                  sessionId={session.sessionId}
                  theme={props.theme}
                  onExpand={(): void => {
                    props.onExpandSession(session.sessionId);
                  }}
                  onMinimize={noop}
                  onTerminate={(): void => {
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

function createDockStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    position: "fixed",
    left: theme.spacing.sm,
    right: theme.spacing.sm,
    bottom: theme.spacing.sm,
    display: "flex",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createRootStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createSessionListStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
    maxWidth: "100%",
    overflowX: "auto",
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
    pointerEvents: "auto",
  };
}

function noop(): void {}
