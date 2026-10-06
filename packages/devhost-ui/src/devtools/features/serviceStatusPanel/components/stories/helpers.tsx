import { useCallback, useState, type ComponentProps, type JSX } from "react";

import type { WorktreeRepository } from "../../../../shared/types";
import { ServiceStatusPanel } from "../ServiceStatusPanel";

type ServiceStatusPanelProps = ComponentProps<typeof ServiceStatusPanel>;

export function WorktreePanelHarness(args: ServiceStatusPanelProps): JSX.Element {
  const [repositories, setRepositories] = useState<WorktreeRepository[]>(args.repositories ?? []);
  const onSwitch = useCallback(
    async (id: string, path: string): Promise<string | null> => {
      const error = (await args.onSwitchWorktree?.(id, path)) ?? null;
      setRepositories((current) =>
        current.map((repository) =>
          repository.id === id
            ? { ...repository, selectedPath: path, runningPath: error === null ? path : "", error: error ?? undefined }
            : repository,
        ),
      );
      return error;
    },
    [args.onSwitchWorktree],
  );
  return <ServiceStatusPanel {...args} repositories={repositories} onSwitchWorktree={onSwitch} />;
}
