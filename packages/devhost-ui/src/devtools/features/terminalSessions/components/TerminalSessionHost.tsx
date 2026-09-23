import type { JSX } from "react";

import { TerminalSessionPanel } from "./TerminalSessionPanel";
import type { TerminalSession, TerminalSessionStatus } from "../types";

interface ITerminalSessionHostProps {
  isMinimapVisible: boolean;
  onMinimizeSession: (sessionId: string) => void;
  onRemoveSession: (sessionId: string) => void;
  onSessionStatusChange: (sessionId: string, status: TerminalSessionStatus, errorMessage: string | null) => void;
  sessions: TerminalSession[];
}

/**
 * Mounts one terminal window per session. Minimized windows stay mounted but hidden, so their websocket and
 * scrollback survive and they keep reporting status; the toolbar chips expand and minimize them.
 */
export function TerminalSessionHost(props: ITerminalSessionHostProps): JSX.Element | null {
  if (props.sessions.length === 0) {
    return null;
  }

  return (
    <div className="contents" data-testid="TerminalSessionHost">
      {props.sessions.map((session: TerminalSession) => (
        <TerminalSessionPanel
          key={session.sessionId}
          isExpanded={session.isExpanded}
          isMinimapVisible={props.isMinimapVisible}
          session={session}
          onMinimize={(): void => {
            props.onMinimizeSession(session.sessionId);
          }}
          onRemove={(): void => {
            props.onRemoveSession(session.sessionId);
          }}
          onStatusChange={(status: TerminalSessionStatus, errorMessage: string | null): void => {
            props.onSessionStatusChange(session.sessionId, status, errorMessage);
          }}
        />
      ))}
    </div>
  );
}
