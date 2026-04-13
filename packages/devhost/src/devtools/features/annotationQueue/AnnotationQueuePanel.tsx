/** @jsxImportSource preact */

import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { Button, css, HoverSlidePanel, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import type { PanelSide } from "../serviceStatusPanel";
import { AnnotationMarkerList } from "../annotationComposer/AnnotationMarkerList";
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
  panelSide: PanelSide;
  onRemoveEntry: (entryId: string) => Promise<boolean>;
  onResumeQueue: (queueId: string) => Promise<string | null>;
  onSaveEntry: (entryId: string, comment: string) => Promise<boolean>;
  queues: IAnnotationQueueSnapshot[];
}

export function AnnotationQueuePanel(props: IAnnotationQueuePanelProps): JSX.Element | null {
  const theme = useDevtoolsTheme();
  const [drafts, setDrafts] = useState<IAnnotationQueueDraft[]>([]);

  useEffect(() => {
    setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
      return mergeAnnotationQueueDrafts(currentDrafts, props.queues);
    });
  }, [props.queues]);

  if (!shouldRenderAnnotationQueuePanel(props.queues, props.errorMessage)) {
    return null;
  }

  const panelClassName: string = css(createPanelStyle(theme));

  return (
    <HoverSlidePanel
      ariaLabel="Annotation queues"
      panelSide={props.panelSide}
      peekWidth={theme.sizes.serviceStatusPanelPeekWidth}
      testId="AnnotationQueuePanel"
    >
      <div class={panelClassName}>
        <div class={css(createHeaderStyle(theme))}>
          <strong>Annotation queues</strong>
          {props.errorMessage !== null ? (
            <div class={css(createErrorStyle(theme))} data-testid="AnnotationQueuePanel--error">
              {props.errorMessage}
            </div>
          ) : null}
        </div>
        <div class={css(createQueueListStyle(theme))} data-testid="AnnotationQueuePanel--queue-list">
          {props.queues.map((queue: IAnnotationQueueSnapshot) => {
            const queueIsPaused: boolean = queue.status === "paused";
            const queueResumePending: boolean = props.isQueueResumePending(queue.queueId);
            const itemCountLabel: string = `${queue.entries.length} item${queue.entries.length === 1 ? "" : "s"}`;

            return (
              <article
                class={css(createQueueCardStyle(theme))}
                data-testid="AnnotationQueuePanel--queue"
                key={queue.queueId}
              >
                <header class={css(createQueueCardHeaderStyle(theme))}>
                  <div class={css(createQueueCardHeaderTextStyle(theme))}>
                    <strong>Annotation queue</strong>
                    <div class={css(createQueueMetaStyle(theme))}>
                      <span>{props.agentDisplayName}</span>
                      <span class={css(createStatusBadgeStyle(theme, queue.status))}>
                        {readStatusLabel(queue.status)}
                      </span>
                      <span>{itemCountLabel}</span>
                    </div>
                  </div>
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
                </header>
                {queueIsPaused && queue.pauseReason !== null ? (
                  <p class={css(createPauseReasonStyle(theme))} data-testid="AnnotationQueuePanel--pause-reason">
                    {readAnnotationQueuePauseMessage(queue.pauseReason)}
                  </p>
                ) : null}
                <ol class={css(createEntryListStyle(theme))}>
                  {queue.entries.map((entry: IAnnotationQueueEntrySnapshot) => {
                    const isEditable: boolean = isAnnotationQueueEntryEditable(entry);
                    const isPending: boolean = props.isEntryMutationPending(entry.entryId);
                    const draftComment: string = readAnnotationQueueDraftComment(drafts, entry);
                    const isSaveDisabled: boolean = isAnnotationQueueEntrySaveDisabled(entry, draftComment, isPending);

                    return (
                      <li
                        class={css(createEntryCardStyle(theme))}
                        data-testid="AnnotationQueuePanel--entry"
                        key={entry.entryId}
                      >
                        <div class={css(createEntryMetaBlockStyle(theme))}>
                          <span class={css(createEntryStateBadgeStyle(theme, entry.state))}>
                            {readEntryStateLabel(entry)}
                          </span>
                          <span>{`${entry.annotation.markers.length} marker${entry.annotation.markers.length === 1 ? "" : "s"}`}</span>
                          <span>{entry.annotation.title}</span>
                          <span>{readAnnotationHost(entry.annotation.url)}</span>
                          <span>{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>

                        <AnnotationMarkerList
                          items={entry.annotation.markers.map((marker) => {
                            return {
                              label: marker.element,
                              markerNumber: marker.markerNumber,
                            };
                          })}
                          listMargin="4px 0"
                        />

                        {isEditable ? (
                          <textarea
                            class={css(createTextareaStyle(theme))}
                            data-testid="AnnotationQueuePanel--comment-input"
                            rows={4}
                            value={draftComment}
                            onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>): void => {
                              setDrafts((currentDrafts: IAnnotationQueueDraft[]): IAnnotationQueueDraft[] => {
                                return upsertAnnotationQueueDraft(
                                  currentDrafts,
                                  entry.entryId,
                                  event.currentTarget.value,
                                );
                              });
                            }}
                          />
                        ) : (
                          <div
                            class={css(createReadOnlyCommentStyle(theme))}
                            data-testid="AnnotationQueuePanel--comment"
                          >
                            {entry.annotation.comment}
                          </div>
                        )}
                        {isEditable ? (
                          <div class={css(createEntryActionsStyle(theme))}>
                            <Button
                              disabled={isSaveDisabled}
                              testId="AnnotationQueuePanel--save"
                              variant="primary"
                              onClick={(): void => {
                                void props.onSaveEntry(entry.entryId, draftComment);
                              }}
                            >
                              Save
                            </Button>
                            <Button
                              disabled={isPending}
                              testId="AnnotationQueuePanel--remove"
                              variant="danger"
                              onClick={(): void => {
                                void props.onRemoveEntry(entry.entryId);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
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
    return "Paused head";
  }

  return "Queued";
}

function readAnnotationHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  };
}

function createQueueCardHeaderStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "start",
    display: "flex",
    gap: theme.spacing.xs,
    justifyContent: "space-between",
  };
}

function createQueueCardHeaderTextStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    display: "grid",
    gap: theme.spacing.xxs,
  };
}

function createQueueMetaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    alignItems: "center",
    color: theme.colors.mutedForeground,
    display: "flex",
    flexWrap: "wrap",
    fontSize: theme.fontSizes.sm,
    gap: theme.spacing.xs,
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
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
  };
}

function createEntryMetaBlockStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.mutedForeground,
    display: "flex",
    flexWrap: "wrap",
    fontSize: theme.fontSizes.sm,
    gap: theme.spacing.xs,
  };
}

function createEntryStateBadgeStyle(theme: IDevtoolsTheme, state: IAnnotationQueueEntrySnapshot["state"]): CSSObject {
  return {
    background: state === "active" ? theme.colors.selectionBackground : theme.colors.accentBackground,
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
