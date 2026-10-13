import { useLayoutEffect, useRef, useState, type JSX } from "react";
import { ArrowLeftIcon, ChevronRightIcon, GitBranchIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";
import { Button } from "../../../shared";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import type { IWorktreeRepository, ServiceHealth } from "../../../shared/types";
import { formatWorktreePath } from "../formatWorktreePath";
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
  const buttons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const returnFocus = useRef<string | null>(null);
  const { homeDirectoryPath } = readInjectedDevtoolsConfig();
  const selected = props.repositories.find((repository) => repository.id === repositoryId);
  const branches = readNonDefaultBranches(props.repositories);
  const label = branches.length === 0 ? "Worktrees" : `Worktrees, non-default branches: ${branches.join(", ")}`;
  const onBack = (): void => {
    returnFocus.current = repositoryId;
    setRepositoryId(null);
  };
  useLayoutEffect(() => {
    if (repositoryId === null && returnFocus.current !== null) {
      buttons.current.get(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [repositoryId]);
  if (props.repositories.length === 0) return null;

  return (
    <ToolbarPopover
      testId="WorktreeStatusPanel"
      panelLabel={selected === undefined ? "Worktrees" : `${selected.name} · Worktrees`}
      panelWidth="lg"
      triggerLabel={label}
      title={label}
      triggerContent={<Icon glyph={GitBranchIcon} />}
      headerEndEnhancer={
        selected === undefined ? undefined : (
          <Button
            aria-label="Back to worktrees"
            variant="ghost"
            startEnhancer={<Icon glyph={ArrowLeftIcon} />}
            onClick={onBack}
          />
        )
      }
    >
      {selected === undefined ? (
        props.repositories.map((repository) => {
          const checkout = repository.worktrees.find((entry) => entry.path === repository.selectedPath);
          return (
            <Button
              key={repository.id}
              ref={(button): void => {
                if (button === null) buttons.current.delete(repository.id);
                else buttons.current.set(repository.id, button);
              }}
              aria-label={`Choose worktree for ${repository.name}`}
              title={formatWorktreePath(repository.selectedPath, homeDirectoryPath)}
              endEnhancer={<Icon glyph={ChevronRightIcon} />}
              onClick={(): void => setRepositoryId(repository.id)}
            >
              {repository.name}:{" "}
              {checkout?.branch ||
                (checkout?.detached === true ? `Detached ${checkout.head.slice(0, 7)}` : "Unavailable worktree")}
            </Button>
          );
        })
      ) : (
        <WorktreePicker
          key={selected.id}
          repository={selected}
          hasRestartingService={
            props.services.some((service) => service.restarting === true) ||
            props.repositories.some((repository) => repository.switching)
          }
          onBack={onBack}
          onRefresh={props.onRefreshWorktrees}
          onSwitch={props.onSwitchWorktree}
        />
      )}
    </ToolbarPopover>
  );
}
