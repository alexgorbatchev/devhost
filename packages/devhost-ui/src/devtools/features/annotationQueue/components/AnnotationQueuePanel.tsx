import { useEffect, useState, type ChangeEvent, type JSX } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ListOrderedIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { Badge } from "../../../../components/ui/Badge";
import { Textarea } from "../../../../components/ui/Textarea";

import { Button, InlineNotice } from "../../../shared";
import { ToolbarPopover } from "../../../shared/components/ToolbarPopover";
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

type AnnotationBadgeVariant = "default" | "destructive" | "primary";

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

  const hasError: boolean = props.errorMessage !== null;
  const entryCount: number = props.queues.reduce((total: number, queue: IAnnotationQueueSnapshot): number => {
    return total + queue.entries.length;
  }, 0);
  const pausedCount: number = props.queues.filter((queue: IAnnotationQueueSnapshot): boolean => {
    return queue.status === "paused";
  }).length;

  const stopEditing = (entryId: string): void => {
    setEditingEntryIds((currentIds: string[]): string[] => removeId(currentIds, entryId));
  };
  const stopConfirmingDelete = (entryId: string): void => {
    setConfirmDeleteEntryIds((currentIds: string[]): string[] => removeId(currentIds, entryId));
  };

  return (
    <ToolbarPopover
      notice={
        props.errorMessage !== null ? (
          <InlineNotice testId="AnnotationQueuePanel--error" tone="danger">
            {props.errorMessage}
          </InlineNotice>
        ) : undefined
      }
      panelLabel="Annotation queues"
      panelWidth="lg"
      testId="AnnotationQueuePanel"
      triggerContent={
        <>
          {hasError ? (
            <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <ListOrderedIcon aria-hidden="true" className="size-3.5" />
          )}
          <span aria-hidden="true">{entryCount}</span>
          {pausedCount > 0 && !hasError ? (
            <Badge aria-hidden="true" variant="destructive">{`${pausedCount} paused`}</Badge>
          ) : null}
        </>
      }
      triggerLabel={readQueuesTriggerLabel(entryCount, pausedCount, hasError)}
      triggerTone={hasError ? "alert" : "default"}
    >
      <div data-testid="AnnotationQueuePanel--queue-list">
        {props.queues.map((queue: IAnnotationQueueSnapshot) => {
          const queueIsExpanded: boolean = expandedQueueIds.includes(queue.queueId);
          const queueIsPaused: boolean = queue.status === "paused";
          const entryTotal: number = queue.entries.length;

          return (
            <article className="not-first:border-t" data-testid="AnnotationQueuePanel--queue" key={queue.queueId}>
              <header className="flex min-h-6 items-center gap-1.5 py-0.5 pr-1 pl-1">
                <Button
                  aria-expanded={queueIsExpanded}
                  aria-label={queueIsExpanded ? "Hide annotations" : "Show annotations"}
                  startEnhancer={queueIsExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                  testId="AnnotationQueuePanel--queue-toggle"
                  variant="ghost"
                  onClick={(): void => {
                    setExpandedQueueIds((currentIds: string[]): string[] => toggleId(currentIds, queue.queueId));
                  }}
                />
                <strong className="min-w-0 flex-1 truncate" title={queue.entries[0]?.annotation.url}>
                  {readAnnotationQueueRouteLabel(queue)}
                </strong>
                <Badge variant={readQueueStatusBadgeVariant(queue.status)}>{queue.status}</Badge>
                <span className="text-muted-foreground" title={`Working on annotation 1 of ${entryTotal}`}>
                  {entryTotal === 0 ? "0/0" : `1/${entryTotal}`}
                </span>
                {queueIsPaused ? (
                  <Button
                    disabled={props.isQueueResumePending(queue.queueId)}
                    startEnhancer={<PlayIcon />}
                    testId="AnnotationQueuePanel--resume"
                    variant="primary"
                    onClick={(): void => {
                      void props.onResumeQueue(queue.queueId);
                    }}
                  >
                    Resume
                  </Button>
                ) : null}
              </header>
              <div className="h-[3px] bg-accent">
                <div
                  className={queueIsPaused ? "h-full bg-destructive" : "h-full bg-primary"}
                  data-testid="AnnotationQueuePanel--queue-progress"
                  style={{ width: readAnnotationQueueProgressWidth(entryTotal) }}
                />
              </div>
              {queueIsExpanded ? (
                <>
                  {queueIsPaused && queue.pauseReason !== null ? (
                    <p
                      className="m-0 border-t bg-destructive/15 py-1 pr-2 pl-6.5 text-destructive"
                      data-testid="AnnotationQueuePanel--pause-reason"
                    >
                      {readAnnotationQueuePauseMessage(queue.pauseReason)}
                    </p>
                  ) : null}
                  <ol className="m-0 list-none bg-secondary p-0 pb-1">
                    {queue.entries.map((entry: IAnnotationQueueEntrySnapshot) => {
                      const comment: string = readAnnotationQueueDraftComment(drafts, entry);
                      const entryIsEditable: boolean = isAnnotationQueueEntryEditable(entry);
                      const entryIsPending: boolean = props.isEntryMutationPending(entry.entryId);
                      const entryIsEditing: boolean = editingEntryIds.includes(entry.entryId);
                      const entryIsDeleteConfirming: boolean = confirmDeleteEntryIds.includes(entry.entryId);

                      return (
                        <li
                          className="grid gap-1 border-t py-1 pr-1 pl-6.5"
                          data-testid="AnnotationQueuePanel--entry"
                          key={entry.entryId}
                        >
                          <div className="flex min-h-5 items-center gap-1.5">
                            <Badge variant={readEntryBadgeVariant(entry)}>{readEntryStateLabel(entry)}</Badge>
                            <span className="flex-1" />
                            {entryIsEditable && !entryIsEditing && !entryIsDeleteConfirming ? (
                              <>
                                <Button
                                  aria-label="Edit annotation"
                                  disabled={entryIsPending}
                                  startEnhancer={<PencilIcon />}
                                  testId="AnnotationQueuePanel--edit"
                                  title="Edit annotation"
                                  variant="ghost"
                                  onClick={(): void => {
                                    stopConfirmingDelete(entry.entryId);
                                    setEditingEntryIds((currentIds: string[]): string[] => {
                                      return appendId(currentIds, entry.entryId);
                                    });
                                  }}
                                />
                                <Button
                                  aria-label="Delete annotation"
                                  disabled={entryIsPending}
                                  startEnhancer={<Trash2Icon />}
                                  testId="AnnotationQueuePanel--remove"
                                  title="Delete annotation"
                                  variant="ghost"
                                  onClick={(): void => {
                                    stopEditing(entry.entryId);
                                    setConfirmDeleteEntryIds((currentIds: string[]): string[] => {
                                      return appendId(currentIds, entry.entryId);
                                    });
                                  }}
                                />
                              </>
                            ) : null}
                          </div>
                          {entryIsEditing ? (
                            <>
                              <Textarea
                                aria-label="Annotation comment"
                                data-testid="AnnotationQueuePanel--comment-input"
                                rows={3}
                                value={comment}
                                onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => {
                                  const value: string = event.currentTarget.value;

                                  setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
                                    return upsertAnnotationQueueDraft(currentDrafts, entry.entryId, value);
                                  });
                                }}
                              />
                              <div className="flex gap-1">
                                <Button
                                  disabled={isAnnotationQueueEntrySaveDisabled(entry, comment, entryIsPending)}
                                  testId="AnnotationQueuePanel--save"
                                  variant="primary"
                                  onClick={(): void => {
                                    void (async (): Promise<void> => {
                                      if (await props.onSaveEntry(entry.entryId, comment)) {
                                        stopEditing(entry.entryId);
                                      }
                                    })();
                                  }}
                                >
                                  Save
                                </Button>
                                <Button
                                  disabled={entryIsPending}
                                  testId="AnnotationQueuePanel--cancel-edit"
                                  onClick={(): void => {
                                    setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
                                      return upsertAnnotationQueueDraft(
                                        currentDrafts,
                                        entry.entryId,
                                        entry.annotation.comment,
                                      );
                                    });
                                    stopEditing(entry.entryId);
                                  }}
                                >
                                  Cancel
                                </Button>
                              </div>
                            </>
                          ) : (
                            <div
                              className="line-clamp-3 text-lg whitespace-pre-wrap"
                              data-testid="AnnotationQueuePanel--comment"
                            >
                              {comment}
                            </div>
                          )}
                          {entryIsEditable && entryIsDeleteConfirming ? (
                            <div
                              className="flex items-center gap-1.5 rounded-sm border border-destructive bg-destructive/15 px-1.5 py-1 font-semibold text-destructive"
                              data-testid="AnnotationQueuePanel--delete-confirmation"
                              role="alert"
                            >
                              <span className="flex-1">Delete this annotation?</span>
                              <Button
                                disabled={entryIsPending}
                                testId="AnnotationQueuePanel--confirm-delete"
                                variant="danger"
                                onClick={(): void => {
                                  void (async (): Promise<void> => {
                                    if (await props.onRemoveEntry(entry.entryId)) {
                                      stopConfirmingDelete(entry.entryId);
                                      stopEditing(entry.entryId);
                                    }
                                  })();
                                }}
                              >
                                Delete
                              </Button>
                              <Button
                                disabled={entryIsPending}
                                testId="AnnotationQueuePanel--cancel-delete"
                                onClick={(): void => {
                                  stopConfirmingDelete(entry.entryId);
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : null}
            </article>
          );
        })}
      </div>
    </ToolbarPopover>
  );
}

function readQueuesTriggerLabel(entryCount: number, pausedCount: number, hasError: boolean): string {
  const summary: string = `Annotation queues: ${entryCount} ${entryCount === 1 ? "annotation" : "annotations"}`;
  const pausedSuffix: string = pausedCount > 0 ? `, ${pausedCount} paused` : "";
  const errorSuffix: string = hasError ? ", error" : "";

  return `${summary}${pausedSuffix}${errorSuffix}`;
}

function readQueueStatusBadgeVariant(status: AnnotationQueueStatus): AnnotationBadgeVariant {
  if (status === "paused") {
    return "destructive";
  }

  return status === "working" ? "primary" : "default";
}

function readEntryStateLabel(entry: IAnnotationQueueEntrySnapshot): string {
  if (entry.state === "active") {
    return "active";
  }

  if (entry.state === "paused-active") {
    return "paused";
  }

  return "queued";
}

function readEntryBadgeVariant(entry: IAnnotationQueueEntrySnapshot): AnnotationBadgeVariant {
  if (entry.state === "paused-active") {
    return "destructive";
  }

  return entry.state === "active" ? "primary" : "default";
}

function readAnnotationQueueRouteLabel(queue: IAnnotationQueueSnapshot): string {
  const queueUrl: string | undefined = queue.entries[0]?.annotation.url;

  if (queueUrl === undefined) {
    return "Annotation queue";
  }

  try {
    const parsedUrl = new URL(queueUrl);

    return parsedUrl.pathname === "/" ? parsedUrl.host : `${parsedUrl.host}${parsedUrl.pathname}`;
  } catch {
    return queueUrl;
  }
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
