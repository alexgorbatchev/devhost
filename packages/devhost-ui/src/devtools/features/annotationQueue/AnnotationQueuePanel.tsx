import type { CSSObject } from "@emotion/css/create-instance";
import { useEffect, useState, type ChangeEvent, type JSX } from "react";

import { Button, css, HoverSlidePanel, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import {
  isAnnotationQueueEntryEditable,
  isAnnotationQueueEntrySaveDisabled,
  mergeAnnotationQueueDrafts,
  readAnnotationQueueDraftComment,
  readAnnotationQueuePauseMessage,
  shouldRenderAnnotationQueuePanel,
  type IAnnotationQueueDraft,
  upsertAnnotationQueueDraft,
} from "./panelUtils";
import type { IAnnotationQueueEntrySnapshot, IAnnotationQueueSnapshot, AnnotationQueueStatus } from "./types";

interface IAnnotationQueuePanelProps {
  agentDisplayName: string;
  errorMessage: string | null;
  isEntryMutationPending: (entryId: string) => boolean;
  isQueueResumePending: (queueId: string) => boolean;
  onRemoveEntry: (entryId: string) => Promise<boolean>;
  onResumeQueue: (queueId: string) => Promise<string | null>;
  onSaveEntry: (entryId: string, comment: string) => Promise<boolean>;
  queues: IAnnotationQueueSnapshot[];
}

export function AnnotationQueuePanel(props: IAnnotationQueuePanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
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

  const panelClassName: string = css(createPanelStyle(theme));

  return (
    <HoverSlidePanel
      ariaLabel="Annotation queues"
      peekWidth={theme.sizes.serviceStatusPanelPeekWidth}
      testId="AnnotationQueuePanel"
    >
      <div className={panelClassName}>
        <div className={css(createHeaderStyle(theme))}>
          <strong>Annotation queues</strong>
          {props.errorMessage !== null ? (
            <div className={css(createErrorStyle(theme))} data-testid="AnnotationQueuePanel--error">
              {props.errorMessage}
            </div>
          ) : null}
        </div>
        <div className={css(createQueueListStyle(theme))} data-testid="AnnotationQueuePanel--queue-list">
          {props.queues.map((queue: IAnnotationQueueSnapshot) => {
            const queueLabel: string = readAnnotationQueueRouteLabel(queue);
            const queueProgressLabel: string = readAnnotationQueueProgressLabel(queue.entries.length);
            const queueProgressWidth: string = readAnnotationQueueProgressWidth(queue.entries.length);
            const queueIsExpanded: boolean = expandedQueueIds.includes(queue.queueId);
            const queueIsPaused: boolean = queue.status === "paused";
            const queueResumePending: boolean = props.isQueueResumePending(queue.queueId);

            return (
              <article
                className={css(createQueueCardStyle(theme))}
                data-testid="AnnotationQueuePanel--queue"
                key={queue.queueId}
              >
                <header className={css(createQueueCardHeaderStyle(theme))}>
                  <div className={css(createQueueCardHeaderMainStyle(theme))}>
                    <div className={css(createQueueHeaderRowStyle(theme))}>
                      <strong className={css(createQueueLabelStyle(theme))} title={queueLabel}>
                        {queueLabel}
                      </strong>
                      <span className={css(createStatusBadgeStyle(theme, queue.status))}>
                        {readStatusLabel(queue.status)}
                      </span>
                    </div>
                    <div className={css(createQueueProgressLabelStyle(theme))}>{queueProgressLabel}</div>
                    <div className={css(createQueueProgressTrackStyle(theme))}>
                      <div
                        className={css(createQueueProgressFillStyle(theme, queue.status, queueProgressWidth))}
                        data-testid="AnnotationQueuePanel--queue-progress"
                      />
                    </div>
                  </div>
                  <div className={css(createQueueActionsStyle(theme))}>
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
                  <div className={css(createQueueDetailsStyle(theme))}>
                    {queueIsPaused && queue.pauseReason !== null ? (
                      <p
                        className={css(createPauseReasonStyle(theme))}
                        data-testid="AnnotationQueuePanel--pause-reason"
                      >
                        {readAnnotationQueuePauseMessage(queue.pauseReason)}
                      </p>
                    ) : null}
                    <ol className={css(createEntryListStyle(theme))}>
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
                            className={css(createEntryCardStyle(theme))}
                            data-testid="AnnotationQueuePanel--entry"
                            key={entry.entryId}
                          >
                            <div className={css(createEntrySummaryStyle(theme))}>
                              <div className={css(createEntrySummaryTextStyle(theme))}>
                                <span className={css(createEntryStateBadgeStyle(theme, entry.state))}>
                                  {readEntryStateLabel(entry)}
                                </span>
                              </div>
                              {entryIsEditable && !entryIsDeleteConfirming ? (
                                <div className={css(createEntryActionsStyle(theme))}>
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
                              <textarea
                                className={css(createTextareaStyle(theme))}
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
                                className={css(createReadOnlyCommentStyle(theme))}
                                data-testid="AnnotationQueuePanel--comment"
                              >
                                {comment}
                              </div>
                            )}
                            {entryIsEditable && entryIsDeleteConfirming ? (
                              <div
                                className={css(createDeleteConfirmationStyle(theme))}
                                data-testid="AnnotationQueuePanel--delete-confirmation"
                              >
                                <div>Delete this annotation?</div>
                                <div className={css(createEntryActionsStyle(theme))}>
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

function createPanelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xs,
    width: "min(640px, calc(100vw - 24px))",
  };
}

function createHeaderStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xxs,
  };
}

function createErrorStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createQueueListStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xs,
  };
}

function createQueueCardStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    borderRadius: theme.radii.md,
    display: "grid",
    gap: theme.spacing.xs,
  };
}

function createQueueCardHeaderStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    justifyContent: "space-between",
  };
}

function createQueueCardHeaderMainStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    flex: "1 1 240px",
    gap: theme.spacing.xxs,
    minWidth: 0,
  };
}

function createQueueHeaderRowStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    minWidth: 0,
  };
}

function createQueueLabelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.md,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function createQueueProgressLabelStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
  };
}

function createQueueProgressTrackStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.logMinimapBackground,
    borderRadius: theme.radii.pill,
    height: "6px",
    overflow: "hidden",
  };
}

function createStatusBadgeStyle(theme: IDevtoolsTheme, status: AnnotationQueueStatus): CSSObject {
  return {
    background: status === "paused" ? theme.colors.dangerBackground : theme.colors.selectionBackground,
    borderRadius: theme.radii.pill,
    color: status === "paused" ? theme.colors.accentForeground : theme.colors.foreground,
    padding: `2px ${theme.spacing.xs}`,
  };
}

function createQueueProgressFillStyle(theme: IDevtoolsTheme, status: AnnotationQueueStatus, width: string): CSSObject {
  return {
    background: status === "paused" ? theme.colors.dangerBackground : theme.colors.accentBackground,
    borderRadius: theme.radii.pill,
    height: "100%",
    minWidth: width === "0%" ? 0 : theme.spacing.xs,
    width,
  };
}

function createQueueActionsStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    justifyContent: "flex-end",
  };
}

function createQueueDetailsStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xs,
  };
}

function createPauseReasonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    fontSize: theme.fontSizes.sm,
    margin: 0,
  };
}

function createEntryListStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xs,
    listStyle: "none",
    margin: 0,
    padding: 0,
  };
}

function createEntryCardStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.logMinimapBackground,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    display: "grid",
    gap: theme.spacing.xxs,
    padding: theme.spacing.xs,
  };
}

function createEntrySummaryStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "flex-start",
    display: "flex",
    gap: theme.spacing.xs,
    justifyContent: "space-between",
  };
}

function createEntrySummaryTextStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    display: "flex",
    flex: 1,
    gap: theme.spacing.xs,
    minWidth: 0,
  };
}

function createEntryStateBadgeStyle(theme: IDevtoolsTheme, state: IAnnotationQueueEntrySnapshot["state"]): CSSObject {
  return {
    background:
      state === "active"
        ? theme.colors.selectionBackground
        : state === "paused-active"
          ? theme.colors.dangerBackground
          : theme.colors.accentBackground,
    borderRadius: theme.radii.pill,
    color: state === "active" ? theme.colors.foreground : theme.colors.accentForeground,
    padding: `2px ${theme.spacing.xs}`,
  };
}

function createTextareaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    background: theme.colors.background,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.md,
    minHeight: "88px",
    padding: theme.spacing.xs,
    resize: "vertical",
  };
}

function createReadOnlyCommentStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.foreground,
    fontSize: theme.fontSizes.md,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  };
}

function createEntryActionsStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
  };
}

function createDeleteConfirmationStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${theme.colors.dangerBackground}`,
    borderRadius: theme.radii.sm,
    color: theme.colors.dangerForeground,
    display: "grid",
    fontSize: theme.fontSizes.sm,
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  };
}
