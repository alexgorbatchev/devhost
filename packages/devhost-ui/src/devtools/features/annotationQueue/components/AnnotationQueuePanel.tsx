import { useEffect, useState, type ChangeEvent, type JSX } from "react";

import { Badge } from "../../../../components/ui/Badge";
import { Textarea } from "../../../../components/ui/Textarea";
import { cn } from "../../../../lib/utils";

import { Button, HoverSlidePanel, InlineNotice } from "../../../shared";
import {
  isAnnotationQueueEntryEditable,
  isAnnotationQueueEntrySaveDisabled,
  mergeAnnotationQueueDrafts,
  readAnnotationQueueDraftComment,
  readAnnotationQueuePauseMessage,
  shouldRenderAnnotationQueuePanel,
  type IAnnotationQueueDraft,
  upsertAnnotationQueueDraft,
} from "../panelUtils";
import type { IAnnotationQueueEntrySnapshot, IAnnotationQueueSnapshot, AnnotationQueueStatus } from "../types";

interface IAnnotationQueuePanelProps {
  errorMessage: string | null;
  isEntryMutationPending: (entryId: string) => boolean;
  isQueueResumePending: (queueId: string) => boolean;
  onRemoveEntry: (entryId: string) => Promise<boolean>;
  onResumeQueue: (queueId: string) => Promise<string | null>;
  onSaveEntry: (entryId: string, comment: string) => Promise<boolean>;
  queues: IAnnotationQueueSnapshot[];
}

type AnnotationEntryBadgeVariant = "default" | "destructive" | "secondary";

export function AnnotationQueuePanel(props: IAnnotationQueuePanelProps): JSX.Element | null {
  const [confirmDeleteEntryIds, setConfirmDeleteEntryIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<IAnnotationQueueDraft[]>([]);
  const [editingEntryIds, setEditingEntryIds] = useState<string[]>([]);
  const [expandedQueueIds, setExpandedQueueIds] = useState<string[]>([]);

  useEffect(() => {
    const queueIds: string[] = props.queues.map((queue: IAnnotationQueueSnapshot) => queue.queueId);
    const entryIds: string[] = props.queues.flatMap((queue: IAnnotationQueueSnapshot) => {
      return queue.entries.map((entry: IAnnotationQueueEntrySnapshot) => entry.entryId);
    });

    setConfirmDeleteEntryIds((currentIds: string[]): string[] => filterAvailableIds(currentIds, entryIds));
    setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
      return mergeAnnotationQueueDrafts(currentDrafts, props.queues);
    });
    setEditingEntryIds((currentIds: string[]): string[] => filterAvailableIds(currentIds, entryIds));
    setExpandedQueueIds((currentIds: string[]): string[] => filterAvailableIds(currentIds, queueIds));
  }, [props.queues]);

  if (!shouldRenderAnnotationQueuePanel(props.queues, props.errorMessage)) {
    return null;
  }

  return (
    <HoverSlidePanel
      ariaLabel="Annotation queues"
      error={props.errorMessage ?? undefined}
      testId="AnnotationQueuePanel"
      title="Annotation queues"
    >
      <div className="grid w-[min(640px,calc(100vw_-_24px))] gap-2">
        <div className="grid gap-2" data-testid="AnnotationQueuePanel--queue-list">
          {props.queues.map((queue: IAnnotationQueueSnapshot) => {
            const queueLabel: string = readAnnotationQueueRouteLabel(queue);
            const queueProgressLabel: string = readAnnotationQueueProgressLabel(queue.entries.length);
            const queueProgressWidth: string = readAnnotationQueueProgressWidth(queue.entries.length);
            const queueIsExpanded: boolean = expandedQueueIds.includes(queue.queueId);
            const queueIsPaused: boolean = queue.status === "paused";
            const queueResumePending: boolean = props.isQueueResumePending(queue.queueId);

            return (
              <article className="grid gap-2 rounded-md" data-testid="AnnotationQueuePanel--queue" key={queue.queueId}>
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <div className="grid min-w-0 flex-[1_1_240px] gap-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong className="truncate text-sm text-foreground" title={queueLabel}>
                        {queueLabel}
                      </strong>
                      <Badge variant={queue.status === "paused" ? "destructive" : "secondary"}>
                        {readStatusLabel(queue.status)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{queueProgressLabel}</div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full min-w-2 rounded-full",
                          queue.status === "paused" ? "bg-destructive" : "bg-primary",
                        )}
                        data-testid="AnnotationQueuePanel--queue-progress"
                        style={{ width: queueProgressWidth }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {queueIsPaused ? (
                      <Button
                        disabled={queueResumePending}
                        testId="AnnotationQueuePanel--resume"
                        variant="primary"
                        onClick={(): void => {
                          void props.onResumeQueue(queue.queueId);
                        }}
                      >
                        Resume
                      </Button>
                    ) : null}
                    <Button
                      testId="AnnotationQueuePanel--queue-toggle"
                      onClick={(): void => {
                        setExpandedQueueIds((currentIds: string[]): string[] => toggleId(currentIds, queue.queueId));
                      }}
                    >
                      {queueIsExpanded ? "Hide details" : "Show details"}
                    </Button>
                  </div>
                </header>
                {queueIsExpanded ? (
                  <div className="grid gap-2">
                    {queueIsPaused && queue.pauseReason !== null ? (
                      <p className="m-0 text-xs text-muted-foreground" data-testid="AnnotationQueuePanel--pause-reason">
                        {readAnnotationQueuePauseMessage(queue.pauseReason)}
                      </p>
                    ) : null}
                    <ol className="grid list-none gap-2 p-0">
                      {queue.entries.map((entry: IAnnotationQueueEntrySnapshot) => {
                        const comment: string = readAnnotationQueueDraftComment(drafts, entry);
                        const entryIsEditable: boolean = isAnnotationQueueEntryEditable(entry);
                        const entryIsPending: boolean = props.isEntryMutationPending(entry.entryId);
                        const entryIsEditing: boolean = editingEntryIds.includes(entry.entryId);
                        const entryIsDeleteConfirming: boolean = confirmDeleteEntryIds.includes(entry.entryId);
                        const isSaveDisabled: boolean = isAnnotationQueueEntrySaveDisabled(
                          entry,
                          comment,
                          entryIsPending,
                        );

                        return (
                          <li
                            className="grid gap-1 rounded-sm border border-border bg-muted p-2"
                            data-testid="AnnotationQueuePanel--entry"
                            key={entry.entryId}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 flex-1 items-center gap-2">
                                <Badge variant={readEntryBadgeVariant(entry)}>{readEntryStateLabel(entry)}</Badge>
                              </div>
                              {entryIsEditable && !entryIsDeleteConfirming ? (
                                <div className="flex flex-wrap gap-2">
                                  {entryIsEditing ? (
                                    <>
                                      <Button
                                        disabled={isSaveDisabled}
                                        testId="AnnotationQueuePanel--save"
                                        variant="primary"
                                        onClick={(): void => {
                                          void (async (): Promise<void> => {
                                            const didSaveEntry: boolean = await props.onSaveEntry(
                                              entry.entryId,
                                              comment,
                                            );

                                            if (!didSaveEntry) {
                                              return;
                                            }

                                            setEditingEntryIds((currentIds: string[]): string[] => {
                                              return removeId(currentIds, entry.entryId);
                                            });
                                          })();
                                        }}
                                      >
                                        Save
                                      </Button>
                                      <Button
                                        disabled={entryIsPending}
                                        testId="AnnotationQueuePanel--cancel-edit"
                                        onClick={(): void => {
                                          setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                          setDrafts(
                                            (currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
                                              return upsertAnnotationQueueDraft(
                                                currentDrafts,
                                                entry.entryId,
                                                entry.annotation.comment,
                                              );
                                            },
                                          );
                                          setEditingEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                        }}
                                      >
                                        Cancel
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <Button
                                        disabled={entryIsPending}
                                        testId="AnnotationQueuePanel--edit"
                                        onClick={(): void => {
                                          setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                          setEditingEntryIds((currentIds: string[]): string[] => {
                                            return appendId(currentIds, entry.entryId);
                                          });
                                        }}
                                      >
                                        Edit
                                      </Button>
                                      <Button
                                        disabled={entryIsPending}
                                        testId="AnnotationQueuePanel--remove"
                                        variant="danger"
                                        onClick={(): void => {
                                          setEditingEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                          setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                            return toggleId(currentIds, entry.entryId);
                                          });
                                        }}
                                      >
                                        Delete
                                      </Button>
                                    </>
                                  )}
                                </div>
                              ) : null}
                            </div>
                            {entryIsEditing ? (
                              <Textarea
                                data-testid="AnnotationQueuePanel--comment-input"
                                rows={4}
                                value={comment}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
                                  const value = event.currentTarget.value;

                                  setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
                                    return upsertAnnotationQueueDraft(currentDrafts, entry.entryId, value);
                                  });
                                }}
                              />
                            ) : (
                              <div
                                className="whitespace-pre-wrap text-sm leading-normal text-foreground"
                                data-testid="AnnotationQueuePanel--comment"
                              >
                                {comment}
                              </div>
                            )}
                            {entryIsEditable && entryIsDeleteConfirming ? (
                              <InlineNotice testId="AnnotationQueuePanel--delete-confirmation" tone="danger">
                                <div className="grid gap-2">
                                  <div>Delete this annotation?</div>
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      disabled={entryIsPending}
                                      testId="AnnotationQueuePanel--confirm-delete"
                                      variant="danger"
                                      onClick={(): void => {
                                        void (async (): Promise<void> => {
                                          const didRemoveEntry: boolean = await props.onRemoveEntry(entry.entryId);

                                          if (!didRemoveEntry) {
                                            return;
                                          }

                                          setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                          setEditingEntryIds((currentIds: string[]): string[] => {
                                            return removeId(currentIds, entry.entryId);
                                          });
                                        })();
                                      }}
                                    >
                                      Confirm delete
                                    </Button>
                                    <Button
                                      disabled={entryIsPending}
                                      testId="AnnotationQueuePanel--cancel-delete"
                                      onClick={(): void => {
                                        setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                          return removeId(currentIds, entry.entryId);
                                        });
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              </InlineNotice>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </HoverSlidePanel>
  );
}

function readStatusLabel(status: AnnotationQueueStatus): string {
  if (status === "launching") {
    return "Launching";
  }

  if (status === "working") {
    return "Working";
  }

  return "Paused";
}

function readEntryStateLabel(entry: IAnnotationQueueEntrySnapshot): string {
  if (entry.state === "active") {
    return "Active";
  }

  if (entry.state === "paused-active") {
    return "Paused";
  }

  return "Queued";
}

function readEntryBadgeVariant(entry: IAnnotationQueueEntrySnapshot): AnnotationEntryBadgeVariant {
  if (entry.state === "paused-active") {
    return "destructive";
  }

  if (entry.state === "active") {
    return "secondary";
  }

  return "default";
}

function readAnnotationQueueRouteLabel(queue: IAnnotationQueueSnapshot): string {
  const queueUrl: string | undefined = queue.entries[0]?.annotation.url;

  if (queueUrl === undefined) {
    return "Annotation queue";
  }

  return readAnnotationRouteLabel(queueUrl);
}

function readAnnotationRouteLabel(url: string): string {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.pathname === "/" ? parsedUrl.host : `${parsedUrl.host}${parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

function readAnnotationQueueProgressLabel(entryCount: number): string {
  return entryCount === 0 ? "0 of 0" : `1 of ${entryCount}`;
}

function readAnnotationQueueProgressWidth(entryCount: number): string {
  return entryCount === 0 ? "0%" : `${100 / entryCount}%`;
}

function appendId(currentIds: string[], id: string): string[] {
  return currentIds.includes(id) ? currentIds : [...currentIds, id];
}

function filterAvailableIds(currentIds: string[], availableIds: string[]): string[] {
  return currentIds.filter((id: string): boolean => availableIds.includes(id));
}

function removeId(currentIds: string[], id: string): string[] {
  return currentIds.filter((currentId: string): boolean => currentId !== id);
}

function toggleId(currentIds: string[], id: string): string[] {
  return currentIds.includes(id) ? removeId(currentIds, id) : [...currentIds, id];
}
