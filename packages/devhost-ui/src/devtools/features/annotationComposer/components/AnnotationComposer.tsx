import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { Kbd, KbdGroup } from "../../../../components/ui/Kbd";
import { Textarea } from "../../../../components/ui/Textarea";

import { Button, FloatingPanel, InlineNotice, type IAnnotationAction } from "../../../shared";
import { isEventTargetTerminalKeyboardInput } from "../../../shared/isEventTargetTerminalKeyboardInput";
import type { ITerminalSessionStartResult } from "../../terminalSessions/types";
import { AnnotationActionSplitButton } from "./AnnotationActionSplitButton";
import { AnnotationMarkerList } from "./AnnotationMarkerList";
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
      if (isEventTargetTerminalKeyboardInput(event.target) || event.key !== "Escape") {
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
      if (isEventTargetTerminalKeyboardInput(event.target)) {
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

  return (
    <div data-testid="AnnotationComposer">
      <AnnotationSelectionOverlay
        hoveredRectangle={hoveredRectangle}
        isHoveredElementSelected={isHoveredElementSelected}
        isSelectionMode={isSelectionMode}
        selectedTargets={selectedTargets}
        testIdPrefix="AnnotationComposer"
      />
      {selectedTargets.length > 0 && popupCoordinates !== null ? (
        <FloatingPanel
          ref={popupReference}
          className="pointer-events-auto grid w-[min(360px,calc(100vw_-_20px))] gap-2.5 px-2.5 py-2.5 text-xs text-foreground"
          position="fixed"
          style={{ left: popupCoordinates.left, top: popupCoordinates.top }}
          testId="AnnotationComposer--popup"
          onClick={(event: React.MouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
        >
          <div className="grid gap-1">
            <strong>Annotation draft</strong>
            <span className="text-xs text-muted-foreground">
              {isSubmitting ? "Submitting annotation…" : `${selectedTargets.length} markers selected`}
            </span>
          </div>
          <AnnotationMarkerList
            items={selectedTargets.map((selection: ISelectedAnnotationTarget) => {
              return {
                label: selection.candidate.label,
                markerNumber: selection.markerNumber,
              };
            })}
            testId="AnnotationComposer--marker-list"
          />
          <Textarea
            ref={commentTextareaReference}
            data-testid="AnnotationComposer--comment"
            placeholder="Describe the change and refer to markers like #1, #2, #3…"
            rows={5}
            value={comment}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              setComment(event.currentTarget.value);
            }}
          />
          {submissionErrorMessage !== null ? (
            <InlineNotice testId="AnnotationComposer--error" tone="danger">
              {submissionErrorMessage}
            </InlineNotice>
          ) : null}
          {canAppendToActiveAgentSession ? (
            <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={sendToActiveSession}
                onChange={(event: React.ChangeEvent<HTMLInputElement>): void => {
                  setSendToActiveSession(event.currentTarget.checked);
                }}
              />
              Append to active {selectedAction.displayName} queue
            </label>
          ) : null}
          <div className="flex justify-start gap-2">
            {props.annotationActions.length > 1 ? (
              <AnnotationActionSplitButton
                actions={props.annotationActions}
                isActionMenuDisabled={isSubmitting}
                isRunDisabled={trimmedComment.length === 0 || isSubmitting}
                selectedAction={selectedAction}
                onActionSelect={props.onSelectedActionIdChange}
                onRun={(): void => {
                  void submitDraft();
                }}
              />
            ) : (
              <Button
                disabled={trimmedComment.length === 0 || isSubmitting}
                endEnhancer={
                  <KbdGroup>
                    <Kbd>⌘</Kbd>
                    <Kbd>↵</Kbd>
                  </KbdGroup>
                }
                variant="primary"
                onClick={(): void => {
                  void submitDraft();
                }}
              >
                {isSubmitting ? "Submitting…" : `Run ${selectedAction.displayName}`}
              </Button>
            )}
            <Button disabled={isSubmitting} endEnhancer={<Kbd>Esc</Kbd>} variant="secondary" onClick={cancelDraft}>
              Cancel
            </Button>
          </div>
        </FloatingPanel>
      ) : null}
    </div>
  );
}

const annotationPopupViewportPadding: number = 10;
