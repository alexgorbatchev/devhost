import { Button } from "@alexgorbatchev/shadcn";
import type { JSX } from "react";
import type { RunningAgent } from "../../../shared/readRunningAgents";
import { formatChatSessionLabel } from "../formatChatSessionLabel";
import type { ChatDecision, ChatDecisionHandler } from "../types";

function describeAgent(agent: RunningAgent): string {
  const name = agent.name ? `${agent.harness} (${agent.name})` : agent.harness;
  const place = agent.subdirectory === "." ? "this checkout" : agent.subdirectory;
  if (agent.state === "waiting") return `${name} is waiting for approval in ${place}.`;
  if (agent.state === "unknown") return `${name} is running in ${place}; its state is unknown.`;
  return `${name} is working in ${place}.`;
}

interface IChatDecisionPromptProps {
  decision: ChatDecision;
  onDecide: ChatDecisionHandler;
}

/** Asks before starting an agent beside another one, or before choosing between running conversations. */
export function ChatDecisionPrompt({ decision, onDecide }: IChatDecisionPromptProps): JSX.Element {
  return (
    <div
      data-testid="ChatDecisionPrompt"
      role="alertdialog"
      aria-label="Choose how to continue"
      className="flex flex-col gap-1 p-2"
    >
      {decision.kind === "agents" ? (
        <>
          {decision.agents.map((agent) => (
            <p key={agent.key}>{describeAgent(agent)}</p>
          ))}
          <p className="text-muted-foreground">devhost did not start it, so chat cannot reach it.</p>
        </>
      ) : (
        <p>Several conversations are running. Which one should get this request?</p>
      )}
      <div className="flex flex-wrap gap-1">
        {decision.kind === "agents" ? (
          <Button size="sm" onClick={() => onDecide({ kind: "start" })}>
            Start Anyway
          </Button>
        ) : (
          decision.sessions.map((session) => (
            <Button key={session.id} size="sm" onClick={() => onDecide({ kind: "join", session })}>
              {formatChatSessionLabel(session)}
            </Button>
          ))
        )}
        <Button size="sm" variant="ghost" onClick={() => onDecide({ kind: "cancel" })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
