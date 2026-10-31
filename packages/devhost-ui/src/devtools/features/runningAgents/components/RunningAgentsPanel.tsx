import { BotIcon, LoaderCircleIcon } from "lucide-react";
import type { JSX } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import type { RunningAgent } from "../../../shared/readRunningAgents";
import { formatAgentActivity } from "../formatAgentActivity";

const STATE_LABELS: Readonly<Record<RunningAgent["state"], string>> = {
  working: "Working",
  waiting: "Waiting for approval",
  idle: "Idle",
  unknown: "Running, state unknown",
};

interface IRunningAgentsPanelProps {
  agents: readonly RunningAgent[];
}

/** Lists the agents in this checkout, including ones devhost did not start. The list only reports: it sends nothing. */
export function RunningAgentsPanel({ agents }: IRunningAgentsPanelProps): JSX.Element | null {
  if (agents.length === 0) return null;
  const isWorking = agents.some((agent) => agent.state === "working");
  return (
    <ToolbarPopover
      panelLabel="Running agents"
      panelWidth="md"
      testId="RunningAgentsPanel"
      title="Agents in this checkout"
      triggerContent={
        <>
          <Icon glyph={isWorking ? LoaderCircleIcon : BotIcon} isSpinning={isWorking} />
          {agents.length}
        </>
      }
      triggerLabel={`Running agents: ${agents.length}`}
    >
      <ul className="flex flex-col gap-2">
        {agents.map((agent) => (
          <li key={agent.key} data-testid="RunningAgentsPanel--agent">
            <p className="font-semibold">
              {agent.harness}
              {agent.name ? ` · ${agent.name}` : ""}
              {agent.isOwned ? " · this chat" : ""}
            </p>
            <p className="text-muted-foreground">
              {`${STATE_LABELS[agent.state]} · ${agent.subdirectory} · ${formatAgentActivity(agent.lastActivity, Date.now())}`}
            </p>
          </li>
        ))}
      </ul>
    </ToolbarPopover>
  );
}
