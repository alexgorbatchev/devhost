import type { JSX } from "preact";

import type { IAnnotationSubmitDetail } from "../annotationComposer/types";
import { type IDevtoolsTheme } from "../../shared";
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

  return (
    <div data-testid="DevtoolsPiTerminalTray" style={createRootStyle(props.theme)}>
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
        <div data-testid="DevtoolsPiTerminalTray--dock" style={createDockStyle(props.theme)}>
          <div data-testid="DevtoolsPiTerminalTray--session-list" style={createSessionListStyle(props.theme)}>
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

function createDockStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
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

function createRootStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createSessionListStyle(theme: IDevtoolsTheme): JSX.CSSProperties {
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
