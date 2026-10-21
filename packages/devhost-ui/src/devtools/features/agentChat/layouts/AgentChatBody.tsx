import type { JSX, ReactNode } from "react";

interface IAgentChatBodyProps {
  children: ReactNode;
  requests: ReactNode;
}

export function AgentChatBody({ children, requests }: IAgentChatBodyProps): JSX.Element {
  return (
    <div data-testid="AgentChatBody" className="flex min-h-0 flex-1 flex-col">
      <div className="max-h-[40%] shrink-0 overflow-auto">{requests}</div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
