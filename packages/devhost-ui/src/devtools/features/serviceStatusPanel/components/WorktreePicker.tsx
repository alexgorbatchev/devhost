import { useEffect, useId, useRef, useState, type JSX } from "react";
import { RotateCwIcon } from "lucide-react";
import fuzzysort from "fuzzysort";

import { Icon } from "../../../../components/ui/Icon";

import { Badge } from "../../../../components/ui/Badge";
import { Button, InlineNotice } from "../../../shared";
import { PanelActions } from "../../../shared/components/PanelActions";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
import type { IWorktree, IWorktreeRepository } from "../../../shared/types";
import { readInjectedDevtoolsConfig } from "../../../shared/readInjectedDevtoolsConfig";
import { formatHomePath } from "../../../shared/formatHomePath";
import { pristineFetch } from "../../../shared/pristineFetch";
import { requestWorktrees } from "../requestWorktrees";

interface IWorktreePickerProps {
  repository: IWorktreeRepository;
  hasRestartingService: boolean;
  onClose: () => void;
  onRefresh: () => Promise<string | null>;
  onSwitch: (repositoryId: string, path: string) => Promise<string | null>;
}

export function WorktreePicker({
  repository,
  hasRestartingService,
  onClose,
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
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const searchReference = useRef<HTMLInputElement | null>(null);
  const isBusy = repository.switching || isSubmitting || isStopping;
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
    if (message === null) onClose();
  };

  const stopOwner = async (destination: string, ownerId: string): Promise<void> => {
    setIsStopping(true);
    setErrorMessage(null);
    const result = await requestWorktrees(pristineFetch, {
      repositoryId: repository.id,
      path: destination,
      stopOwnerId: ownerId,
    });
    const refreshError = await onRefresh();
    setErrorMessage(result.error ?? refreshError);
    setIsLoaded(refreshError === null);
    setIsStopping(false);
  };

  return (
    <div data-testid="WorktreePicker">
      {repository.error !== undefined || errorMessage !== null ? (
        <InlineNotice tone="danger">{errorMessage ?? repository.error}</InlineNotice>
      ) : null}
      {repository.blockedReason !== undefined ? (
        <InlineNotice tone="danger">{repository.blockedReason}</InlineNotice>
      ) : null}

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">Choose a checkout for {repository.name}</legend>
        {worktrees.map((entry) => (
          <div key={entry.path} className="flex items-start gap-2 px-2 py-1.5 not-first:border-t has-checked:bg-accent">
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 has-disabled:cursor-default">
              <input
                aria-label={`${worktreeLabel(entry)} ${formatHomePath(entry.path, homeDirectoryPath)}`}
                className="mt-0.5 size-3.5 shrink-0 accent-primary"
                type="radio"
                name={name}
                value={entry.path}
                checked={path === entry.path}
                disabled={!entry.available || isBusy || isLoading || !isLoaded}
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
                </span>
                <span className="block truncate text-left text-muted-foreground [direction:rtl]" title={entry.path}>
                  <bdi dir="ltr">{formatHomePath(entry.path, homeDirectoryPath)}</bdi>
                </span>
              </span>
            </label>
            {!entry.available ? (
              <ToolbarPopover
                panelLabel={`${worktreeLabel(entry)} · Unavailable`}
                panelWidth="sm"
                testId="WorktreePicker--unavailable"
                triggerAppearance="button"
                triggerContent={<Badge variant="destructive">{entry.owners?.length ? "in use" : "unavailable"}</Badge>}
                triggerLabel={`Why ${worktreeLabel(entry)} is unavailable`}
              >
                <p className="m-0 p-2 [overflow-wrap:anywhere]">{entry.reason ?? "This checkout is unavailable."}</p>
                {entry.owners?.map((owner) => (
                  <div key={owner.id} className="flex flex-col gap-2 border-t p-2 [overflow-wrap:anywhere]">
                    <strong>
                      {owner.name} · PID {owner.pid}
                    </strong>
                    <span>{formatHomePath(owner.manifestPath, homeDirectoryPath)}</span>
                    {owner.urls.length === 0 ? (
                      <p className="m-0">This stack has no routed page.</p>
                    ) : (
                      owner.urls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline"
                        >
                          Open stack · {url}
                        </a>
                      ))
                    )}
                    <p className="m-0">Stop all services in this stack to free the checkout.</p>
                    <Button
                      disabled={isBusy || isLoading || !isLoaded}
                      onClick={(): void => {
                        void stopOwner(entry.path, owner.id);
                      }}
                    >
                      Stop stack
                    </Button>
                  </div>
                ))}
              </ToolbarPopover>
            ) : null}
          </div>
        ))}
      </fieldset>
      {worktrees.length === 0 && isLoaded && !isLoading ? (
        <p className="m-0 p-2 text-muted-foreground" role="status">
          No matching worktrees.
        </p>
      ) : null}
      <footer className="flex flex-col gap-2 border-t-[3px] border-border p-2">
        {isLoading || isBusy ? (
          <p className="m-0 flex items-center gap-1.5 text-warning" role="status">
            <Icon glyph={RotateCwIcon} isSpinning />
            {isLoading
              ? "Loading worktrees…"
              : isStopping
                ? "Stopping other stack…"
                : "Switching and restarting stack…"}
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
            {repository.error !== undefined && path === repository.selectedPath ? "Retry" : "Switch and restart stack"}
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
          <Button onClick={onClose}>{isBusy ? "Close" : "Cancel"}</Button>
        </div>
      </footer>
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
    </div>
  );
}

function worktreeLabel(entry: IWorktree): string {
  return entry.branch || (entry.detached ? `Detached ${entry.head.slice(0, 7)}` : "Unavailable worktree");
}
