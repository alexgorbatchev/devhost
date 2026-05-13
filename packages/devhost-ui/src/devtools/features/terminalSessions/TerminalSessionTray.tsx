import type { JSX } from "react";

import { TerminalSessionPanel } from "./TerminalSessionPanel";
import type { TerminalSession } from "./types";

interface ITerminalSessionTrayProps {
  onExpandSession: (sessionId: string) => void;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  sessions: TerminalSession[];
}

export function TerminalSessionTray(props: ITerminalSessionTrayProps): JSX.Element | null {
  const expandedSession: TerminalSession | undefined = props.sessions.find(
    (session: TerminalSession): boolean => session.isExpanded,
  );
  const minimizedSessions: TerminalSession[] = props.sessions.filter(
    (session: TerminalSession): boolean => !session.isExpanded,
  );

  if (expandedSession === undefined && minimizedSessions.length === 0) {
    return null;
  }

  return (
    <div data-testid="TerminalSessionTray">
      {expandedSession !== undefined ? (
        <div
          className="pointer-events-none fixed inset-0 z-[var(--devhost-z-terminal-expanded)]"
          data-testid="TerminalSessionTray--expanded-root"
        >
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
        <div
          className="pointer-events-none fixed inset-0 z-[var(--devhost-z-terminal-tray)]"
          data-testid="TerminalSessionTray--tray-root"
        >
          <div
            className="pointer-events-none fixed inset-x-2.5 bottom-2.5 flex justify-center"
            data-testid="TerminalSessionTray--dock"
          >
            <div
              className="pointer-events-auto flex max-w-full items-end gap-2.5 overflow-x-auto px-2.5 py-2"
              data-testid="TerminalSessionTray--session-list"
            >
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
