import { useEffect, useId, useRef, useState, type JSX } from "react";
import { RotateCwIcon } from "lucide-react";
import fuzzysort from "fuzzysort";

import { Icon } from "../../../../components/ui/Icon";

import { Badge } from "../../../../components/ui/Badge";
import { cn } from "../../../../lib/utils";
import { Button, InlineNotice } from "../../../shared";
import { PanelActions } from "../../../shared/components/PanelActions";
import type { IWorktree, IWorktreeRepository } from "../../../shared/types";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import { formatWorktreePath } from "../formatWorktreePath";

interface IWorktreePickerProps {
  repository: IWorktreeRepository;
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
  const { homeDirectoryPath } = readInjectedDevtoolsConfig();
  const name = useId();
  const [path, setPath] = useState<string>(repository.selectedPath);
  const [query, setQuery] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchReference = useRef<HTMLInputElement | null>(null);
  const isBusy = repository.switching || isSubmitting;
  const worktrees = query.trim()
    ? fuzzysort
        .go(query.trim(), repository.worktrees, {
          keys: [worktreeLabel, "path"],
          threshold: 0,
          limit: 0,
        })
        .map((result) => result.obj)
    : repository.worktrees;
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
    searchReference.current?.focus();
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
      <PanelActions>
        <input
          ref={searchReference}
          type="search"
          aria-label="Find worktree"
          placeholder="Find branch or checkout path…"
          className="h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-foreground placeholder:text-muted-foreground disabled:opacity-50"
          disabled={isBusy || isLoading || !isLoaded}
          value={query}
          onChange={(event): void => setQuery(event.currentTarget.value)}
        />
        <Button
          aria-label="Refresh worktrees"
          disabled={isLoading || isBusy}
          startEnhancer={<Icon glyph={RotateCwIcon} />}
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
      </PanelActions>
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={isBusy || isLoading || !isLoaded}>
        <legend className="sr-only">Choose a checkout for {repository.name}</legend>
        {worktrees.map((entry) => (
          <label
            key={entry.path}
            className={cn(
              "flex cursor-pointer items-start gap-2 px-2 py-1.5 not-first:border-t hover:bg-secondary has-checked:bg-accent has-disabled:cursor-default has-disabled:opacity-50",
            )}
          >
            <input
              aria-label={`${worktreeLabel(entry)} ${formatWorktreePath(entry.path, homeDirectoryPath)}`}
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
              <span className="text-muted-foreground [overflow-wrap:anywhere]">
                {formatWorktreePath(entry.path, homeDirectoryPath)}
              </span>
              {entry.reason !== undefined ? (
                <span className="text-destructive [overflow-wrap:anywhere]">{entry.reason}</span>
              ) : null}
            </span>
          </label>
        ))}
      </fieldset>
      {worktrees.length === 0 && isLoaded && !isLoading ? (
        <p className="m-0 p-2 text-muted-foreground" role="status">
          No matching worktrees.
        </p>
      ) : null}
      <footer className="flex flex-col gap-2 border-t-[3px] border-border p-2">
        <p className="m-0 text-muted-foreground">Your choice is remembered across devhost restarts.</p>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
          {choice?.directories.map((directory) => (
            <WorktreeCommand
              key={directory.name}
              name={directory.name}
              cwd={formatWorktreePath(directory.cwd, homeDirectoryPath)}
            />
          ))}
        </dl>
        {isLoading || isBusy ? (
          <p className="m-0 flex items-center gap-1.5 text-warning" role="status">
            <Icon glyph={RotateCwIcon} isSpinning />
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
