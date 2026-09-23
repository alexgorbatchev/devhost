import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { XIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/Card";
import { Kbd } from "../../../../components/ui/Kbd";
import { Textarea } from "../../../../components/ui/Textarea";

import { Button, InlineNotice, type IAnnotationAction } from "../../../shared";
import { useRetainedValue } from "../../../shared/hooks/useRetainedValue";
import { isEventTargetTerminalKeyboardInput } from "../../../shared/isEventTargetTerminalKeyboardInput";
import type { ITerminalSessionStartResult } from "../../terminalSessions/types";
import { AnnotationActionSplitButton } from "./AnnotationActionSplitButton";
import { AnnotationMarkerList } from "./AnnotationMarkerList";
import { AnnotationSelectionHint } from "./AnnotationSelectionHint";
import { AnnotationSelectionOverlay } from "./AnnotationSelectionOverlay";
import {
  readActiveAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
} from "../annotationSelectionPluginRegistry";
import { type ISelectedAnnotationTarget, resolveSelectedAnnotationAction } from "../annotationComposerModels";
import { createAnnotationSubmitDetail } from "../createAnnotationSubmitDetail";
import type { IAnnotationSubmitDetail } from "../types";
import { useAnnotationSelectionDraft } from "../hooks/useAnnotationSelectionDraft";

interface IAnnotationComposerProps {
  activeAgentSessionId?: string;
  annotationActions: IAnnotationAction[];
  selectedActionId: string;
  onSelectedActionIdChange: (actionId: string) => void;
  onSubmit: (
    detail: IAnnotationSubmitDetail,
    action: IAnnotationAction,
    targetSessionId?: string,
  ) => Promise<ITerminalSessionStartResult>;
  stackName: string;
}

export function AnnotationComposer(props: IAnnotationComposerProps): JSX.Element {
  const [annotationSelectionPluginVersion, setAnnotationSelectionPluginVersion] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [sendToActiveSession, setSendToActiveSession] = useState<boolean>(true);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState<string | null>(null);
  const commentTextareaReference = useRef<HTMLTextAreaElement | null>(null);
  const annotationSelectionPlugin = useMemo(readActiveAnnotationSelectionPlugin, [annotationSelectionPluginVersion]);
  const trimmedComment: string = comment.trim();
  const {
    hoveredLabel,
    hoveredRectangle,
    isHoveredElementSelected,
    isSelectionMode,
    popupCoordinates,
    popupReference,
    resetSelectionDraft,
    selectedTargets,
  } = useAnnotationSelectionDraft({
    annotationSelectionPlugin,
    comment,
    isSubmitting,
    submissionErrorMessage,
    viewportPadding: annotationPopupViewportPadding,
  });
  const hasActiveAnnotationInteraction: boolean =
    isSelectionMode || selectedTargets.length > 0 || trimmedComment.length > 0;
  const hasDraft: boolean = selectedTargets.length > 0 || trimmedComment.length > 0;
  const selectedAction: IAnnotationAction = resolveSelectedAnnotationAction(
    props.annotationActions,
    props.selectedActionId,
  );
  const canAppendToActiveAgentSession: boolean =
    selectedAction.kind === "agent" && selectedAction.queueEnabled && props.activeAgentSessionId !== undefined;

  const cancelDraft = useCallback((): void => {
    setComment("");
    setIsSubmitting(false);
    setSubmissionErrorMessage(null);
    resetSelectionDraft();
  }, [resetSelectionDraft]);

  const submitDraft = useCallback(async (): Promise<void> => {
    if (trimmedComment.length === 0 || selectedTargets.length === 0 || isSubmitting) {
      return;
    }

    const markers = await Promise.all(
      selectedTargets.map((selectedTarget: ISelectedAnnotationTarget) => {
        return selectedTarget.candidate.buildMarkerPayload(selectedTarget.markerNumber);
      }),
    );
    const detail: IAnnotationSubmitDetail = createAnnotationSubmitDetail({
      comment: trimmedComment,
      markers,
      stackName: props.stackName,
      submittedAt: Date.now(),
      title: document.title,
      url: window.location.href,
    });

    setIsSubmitting(true);
    setSubmissionErrorMessage(null);

    try {
      const submitResult: ITerminalSessionStartResult = await props.onSubmit(
        detail,
        selectedAction,
        canAppendToActiveAgentSession && sendToActiveSession ? props.activeAgentSessionId : undefined,
      );

      if (submitResult.success) {
        cancelDraft();
        return;
      }

      setSubmissionErrorMessage(
        submitResult.errorMessage ?? `Failed to start the ${selectedAction.displayName} action.`,
      );
    } catch (error) {
      setSubmissionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    cancelDraft,
    canAppendToActiveAgentSession,
    isSubmitting,
    props,
    selectedAction,
    selectedTargets,
    trimmedComment,
    sendToActiveSession,
  ]);

  useEffect(() => {
    return subscribeToAnnotationSelectionPlugins((): void => {
      setAnnotationSelectionPluginVersion((currentVersion: number): number => currentVersion + 1);
    });
  }, []);

  useEffect(() => {
    if (!hasActiveAnnotationInteraction) {
      return;
    }

    const handleEscapeKeyDown = (event: KeyboardEvent): void => {
      const target = event.composedPath()[0] || event.target;
      if (isEventTargetTerminalKeyboardInput(target) || event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      cancelDraft();
    };

    document.addEventListener("keydown", handleEscapeKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleEscapeKeyDown, true);
    };
  }, [cancelDraft, hasActiveAnnotationInteraction]);

  useEffect(() => {
    if (!hasDraft) {
      return;
    }

    const handleSubmitKeyDown = (event: KeyboardEvent): void => {
      const target = event.composedPath()[0] || event.target;
      if (isEventTargetTerminalKeyboardInput(target)) {
        return;
      }

      if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) {
        return;
      }

      event.preventDefault();
      void submitDraft();
    };

    document.addEventListener("keydown", handleSubmitKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleSubmitKeyDown, true);
    };
  }, [hasDraft, submitDraft]);

  useEffect(() => {
    if (selectedTargets.length !== 1) {
      return;
    }

    const animationFrameId: number = window.requestAnimationFrame((): void => {
      commentTextareaReference.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [selectedTargets.length]);

  const isPopupOpen: boolean = selectedTargets.length > 0 && popupCoordinates !== null;
  // The popup stays mounted while it fades out; keep showing the last draft instead of an emptied form.
  const displayedTargets: ISelectedAnnotationTarget[] = useRetainedValue(selectedTargets, isPopupOpen);
  const displayedCoordinates = useRetainedValue(popupCoordinates, isPopupOpen);
  const displayedComment: string = useRetainedValue(comment, isPopupOpen);
  const runLabel: string = isSubmitting ? "Submitting…" : `Run ${selectedAction.displayName}`;
  const markerCountLabel: string = `${displayedTargets.length} ${displayedTargets.length === 1 ? "marker" : "markers"}`;

  return (
    <div data-testid="AnnotationComposer">
      <AnnotationSelectionOverlay
        hoveredLabel={hoveredLabel}
        hoveredRectangle={hoveredRectangle}
        isHoveredElementSelected={isHoveredElementSelected}
        isSelectionMode={isSelectionMode}
        selectedTargets={selectedTargets}
        testIdPrefix="AnnotationComposer"
      />
      <AnnotationSelectionHint isVisible={isSelectionMode && selectedTargets.length === 0} />
      {displayedCoordinates !== null ? (
        <section
          ref={popupReference}
          aria-label="Annotation draft"
          className="devhost-fade pointer-events-auto fixed z-(--devhost-z-popover) w-80 max-w-[calc(100vw-20px)]"
          data-testid="AnnotationComposer--popup"
          hidden={!isPopupOpen}
          inert={!isPopupOpen}
          role="dialog"
          style={{ left: displayedCoordinates.left, top: displayedCoordinates.top }}
          onClick={(event: React.MouseEvent<HTMLElement>): void => {
            event.stopPropagation();
          }}
          onMouseDown={(event: React.MouseEvent<HTMLElement>): void => {
            event.stopPropagation();
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>
                Annotate{" "}
                <span className="font-normal text-muted-foreground">
                  {isSubmitting ? "submitting…" : markerCountLabel}
                </span>
              </CardTitle>
              <Button
                aria-label="Cancel annotation"
                disabled={isSubmitting}
                startEnhancer={<XIcon />}
                testId="AnnotationComposer--close"
                title="Cancel (Esc)"
                variant="ghost"
                onClick={cancelDraft}
              />
            </CardHeader>
            {submissionErrorMessage !== null ? (
              <InlineNotice testId="AnnotationComposer--error" tone="danger">
                {submissionErrorMessage}
              </InlineNotice>
            ) : null}
            <CardContent>
              <AnnotationMarkerList
                items={displayedTargets.map((selection: ISelectedAnnotationTarget) => {
                  return {
                    label: selection.candidate.label,
                    markerNumber: selection.markerNumber,
                  };
                })}
                testId="AnnotationComposer--marker-list"
              />
              <Textarea
                ref={commentTextareaReference}
                aria-label="Annotation comment"
                data-testid="AnnotationComposer--comment"
                placeholder="Describe the change. Refer to markers as #1, #2…"
                rows={4}
                value={displayedComment}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
                  setComment(event.currentTarget.value);
                }}
              />
              {canAppendToActiveAgentSession ? (
                <label className="flex cursor-pointer items-center gap-1.5 select-none">
                  <input
                    checked={sendToActiveSession}
                    className="m-0 accent-primary"
                    type="checkbox"
                    onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                      setSendToActiveSession(event.currentTarget.checked);
                    }}
                  />
                  Append to active {selectedAction.displayName} queue
                </label>
              ) : null}
              <div className="flex items-center gap-1.5">
                {props.annotationActions.length > 1 ? (
                  <AnnotationActionSplitButton
                    actions={props.annotationActions}
                    isActionMenuDisabled={isSubmitting}
                    isRunDisabled={trimmedComment.length === 0 || isSubmitting}
                    runLabel={runLabel}
                    selectedAction={selectedAction}
                    onActionSelect={props.onSelectedActionIdChange}
                    onRun={(): void => {
                      void submitDraft();
                    }}
                  />
                ) : (
                  <Button
                    disabled={trimmedComment.length === 0 || isSubmitting}
                    endEnhancer={<Kbd>⌘↵</Kbd>}
                    variant="primary"
                    onClick={(): void => {
                      void submitDraft();
                    }}
                  >
                    {runLabel}
                  </Button>
                )}
                <span className="flex-1" />
                <Button disabled={isSubmitting} endEnhancer={<Kbd>Esc</Kbd>} variant="ghost" onClick={cancelDraft}>
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

const annotationPopupViewportPadding: number = 10;
