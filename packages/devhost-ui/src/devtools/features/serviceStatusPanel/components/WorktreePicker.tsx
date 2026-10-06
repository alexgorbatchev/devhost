import { useEffect, useId, useRef, useState, type JSX } from "react";
import { RotateCwIcon } from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";
import { Button, InlineNotice } from "../../../shared";
import type { IWorktree, WorktreeRepository } from "../../../shared/types";

interface IWorktreePickerProps {
  repository: WorktreeRepository;
  hasRestartingService: boolean;
  onBack: () => void;
  onRefresh: () => Promise<string | null>;
  onSwitch: (repositoryId: string, path: string) => Promise<string | null>;
}

export function WorktreePicker({
  repository,
  hasRestartingService,
  onBack,
  onRefresh,
  onSwitch,
}: IWorktreePickerProps): JSX.Element {
  const name = useId();
  const [path, setPath] = useState<string>(repository.selectedPath);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formReference = useRef<HTMLFieldSetElement | null>(null);
  const isBusy = repository.switching || isSubmitting;
  const choice = repository.worktrees.find((entry) => entry.path === path);
  const canSwitch =
    isLoaded &&
    !isLoading &&
    !isBusy &&
    !hasRestartingService &&
    repository.blockedReason === undefined &&
    choice?.available === true &&
    (path !== repository.selectedPath || repository.error !== undefined);

  useEffect(() => {
    let isDisposed = false;
    void onRefresh().then((message) => {
      if (isDisposed) return;
      setErrorMessage(message);
      setIsLoading(false);
      setIsLoaded(message === null);
    });
    return () => {
      isDisposed = true;
    };
  }, [onRefresh]);

  useEffect(() => {
    if (!isLoaded || isLoading) return;
    const selected =
      formReference.current?.querySelector<HTMLInputElement>("input:checked:not(:disabled)") ??
      formReference.current?.querySelector<HTMLInputElement>("input:not(:disabled)");
    selected?.focus();
  }, [isLoaded, isLoading]);

  const apply = async (destination: string): Promise<void> => {
    setIsSubmitting(true);
    setErrorMessage(null);
    const message = await onSwitch(repository.id, destination);
    setIsSubmitting(false);
    setErrorMessage(message);
    if (message === null) onBack();
  };

  return (
    <div data-testid="WorktreePicker">
      {repository.error !== undefined || errorMessage !== null ? (
        <InlineNotice tone="danger">{errorMessage ?? repository.error}</InlineNotice>
      ) : null}
      {repository.blockedReason !== undefined ? (
        <InlineNotice tone="danger">{repository.blockedReason}</InlineNotice>
      ) : null}
      <div className="flex justify-end px-2 py-1">
        <Button
          aria-label="Refresh worktrees"
          disabled={isLoading || isBusy}
          startEnhancer={<RotateCwIcon />}
          onClick={(): void => {
            setIsLoading(true);
            void onRefresh().then((message) => {
              setErrorMessage(message);
              setIsLoaded(message === null);
              setIsLoading(false);
            });
          }}
        >
          Refresh
        </Button>
      </div>
      <fieldset ref={formReference} className="m-0 min-w-0 border-0 p-0" disabled={isBusy || isLoading || !isLoaded}>
        <legend className="sr-only">Choose a checkout for {repository.name}</legend>
        {repository.worktrees.map((entry) => (
          <label
            key={entry.path}
            className={cn(
              "flex cursor-pointer items-start gap-2 px-2 py-1.5 not-first:border-t hover:bg-secondary has-checked:bg-accent has-disabled:cursor-default has-disabled:opacity-50",
            )}
          >
            <input
              aria-label={`${worktreeLabel(entry)} ${entry.path}`}
              className="mt-0.5 size-3.5 shrink-0 accent-primary"
              type="radio"
              name={name}
              value={entry.path}
              checked={path === entry.path}
              disabled={!entry.available}
              onChange={(): void => {
                setPath(entry.path);
                setErrorMessage(null);
              }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-1.5">
                <strong className="min-w-0 flex-1 truncate">{worktreeLabel(entry)}</strong>
                {entry.path === repository.runningPath ? <Badge variant="success">running</Badge> : null}
                {entry.path === repository.configuredPath ? <Badge>configured</Badge> : null}
                {!entry.available ? <Badge variant="destructive">unavailable</Badge> : null}
              </span>
              <span className="text-muted-foreground [overflow-wrap:anywhere]">{entry.path}</span>
              {entry.reason !== undefined ? (
                <span className="text-destructive [overflow-wrap:anywhere]">{entry.reason}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      <footer className="flex flex-col gap-2 border-t-[3px] border-border p-2">
        <p className="m-0 text-muted-foreground">Your choice is remembered across devhost restarts.</p>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          {choice?.directories.map((directory) => (
            <WorktreeCommand key={directory.name} name={directory.name} cwd={directory.cwd} />
          ))}
        </dl>
        {isLoading || isBusy ? (
          <p className="m-0 flex items-center gap-1.5 text-warning" role="status">
            <RotateCwIcon aria-hidden="true" className="size-3.5 animate-spin" />
            {isLoading ? "Loading worktrees…" : "Switching and restarting services…"}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="primary"
            disabled={!canSwitch}
            onClick={(): void => {
              void apply(path);
            }}
          >
            {repository.error !== undefined && path === repository.selectedPath
              ? "Retry"
              : `Switch and restart ${repository.serviceNames.length} service${repository.serviceNames.length === 1 ? "" : "s"}`}
          </Button>
          {repository.error !== undefined && repository.selectedPath !== repository.configuredPath ? (
            <Button
              disabled={
                isBusy ||
                isLoading ||
                !isLoaded ||
                hasRestartingService ||
                repository.blockedReason !== undefined ||
                !repository.worktrees.some((entry) => entry.path === repository.configuredPath && entry.available)
              }
              onClick={(): void => {
                setPath(repository.configuredPath);
                void apply(repository.configuredPath);
              }}
            >
              Return to configured checkout
            </Button>
          ) : null}
          <Button onClick={onBack}>{isBusy ? "Back to services" : "Cancel"}</Button>
        </div>
      </footer>
    </div>
  );
}

interface IWorktreeCommandProps {
  name: string;
  cwd: string;
}

function WorktreeCommand({ name, cwd }: IWorktreeCommandProps): JSX.Element {
  return (
    <>
      <dt>
        <span aria-hidden="true">$ </span>
        {name}
      </dt>
      <dd className="m-0 text-muted-foreground [overflow-wrap:anywhere]">{cwd}</dd>
    </>
  );
}

function worktreeLabel(entry: IWorktree): string {
  return entry.branch || (entry.detached ? `Detached ${entry.head.slice(0, 7)}` : "Unavailable worktree");
}
