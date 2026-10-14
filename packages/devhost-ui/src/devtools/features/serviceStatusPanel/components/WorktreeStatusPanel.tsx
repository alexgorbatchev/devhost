import { useRef, useState, type JSX } from "react";
import { GitBranchIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import type { IWorktreeRepository, ServiceHealth } from "../../../shared/types";
import { readNonDefaultBranches } from "../readNonDefaultBranches";
import { WorktreePicker } from "./WorktreePicker";

interface IWorktreeStatusPanelProps {
  repositories: IWorktreeRepository[];
  services: ServiceHealth[];
  onRefreshWorktrees: () => Promise<string | null>;
  onSwitchWorktree: (repositoryId: string, path: string) => Promise<string | null>;
}

export function WorktreeStatusPanel(props: IWorktreeStatusPanelProps): JSX.Element | null {
  const [repositoryId, setRepositoryId] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState<number>(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = props.repositories.find((repository) => repository.id === repositoryId) ?? props.repositories[0];
  const branches = readNonDefaultBranches(props.repositories);
  const label = branches.length === 0 ? "Worktrees" : `Worktrees, non-default branches: ${branches.join(", ")}`;
  const currentCheckouts = props.repositories.map((repository) => {
    const checkout = repository.worktrees.find((entry) => entry.path === repository.selectedPath);
    const branch =
      checkout?.branch ||
      (checkout?.detached === true ? `Detached ${checkout.head.slice(0, 7)}` : "Unavailable worktree");
    return props.repositories.length === 1 ? branch : `${repository.name}: ${branch}`;
  });
  const close = (): void => {
    const popover = trigger.current?.popoverTargetElement;
    if (popover instanceof HTMLElement) popover.hidePopover();
    trigger.current?.focus();
  };
  if (selected === undefined) return null;

  return (
    <ToolbarPopover
      testId="WorktreeStatusPanel"
      panelLabel="Worktrees"
      panelWidth="lg"
      triggerLabel={label}
      title={branches.length > 0 ? label : `Worktrees: ${currentCheckouts.join(", ")}`}
      triggerReference={trigger}
      triggerContent={
        <>
          <Icon glyph={GitBranchIcon} />
          <span className="truncate">{currentCheckouts.join(", ")}</span>
        </>
      }
      onOpenChange={(isOpen): void => {
        if (isOpen) setOpenCount((count) => count + 1);
      }}
      headerEndEnhancer={
        props.repositories.length > 1 ? (
          <select
            aria-label="Repository"
            className="min-w-0 rounded-sm border border-input bg-background text-foreground"
            value={selected.id}
            onChange={(event): void => setRepositoryId(event.currentTarget.value)}
          >
            {props.repositories.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      {openCount > 0 ? (
        <WorktreePicker
          key={`${selected.id}:${openCount}`}
          repository={selected}
          hasRestartingService={
            props.services.some((service) => service.restarting === true) ||
            props.repositories.some((repository) => repository.switching)
          }
          onClose={close}
          onRefresh={props.onRefreshWorktrees}
          onSwitch={props.onSwitchWorktree}
        />
      ) : null}
    </ToolbarPopover>
  );
}
