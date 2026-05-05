import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { Button, css, type IAnnotationAction, useDevtoolsTheme } from "../../shared";
import { isEventTargetTerminalKeyboardInput } from "../../shared/isEventTargetTerminalKeyboardInput";
import type { ITerminalSessionStartResult } from "../terminalSessions/types";
import { AnnotationActionSplitButton } from "./AnnotationActionSplitButton";
import { AnnotationMarkerList } from "./AnnotationMarkerList";
import {
  createActionButtonHoverStyle,
  createCancelButtonStyle,
  createCheckboxLabelStyle,
  createHoverHighlightStyle,
  createMarkerStyle,
  createPopupStyle,
  createSelectionHighlightStyle,
  createShortcutBadgeStyle,
  createSubmissionErrorStyle,
  createSubmitButtonStyle,
  createTextareaStyle,
  overlayStyle,
  popupActionsStyle,
  popupHeaderStyle,
  popupMetaStyle,
  shortcutBadgeHoverStyle,
} from "./annotationComposerStyles";
import {
  readActiveAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
} from "./annotationSelectionPluginRegistry";
import {
  type IMarkerRenderModel,
  type ISelectedAnnotationTarget,
  readPixelValue,
  resolveSelectedAnnotationAction,
} from "./annotationComposerModels";
import { createAnnotationSubmitDetail } from "./createAnnotationSubmitDetail";
import type { IAnnotationSubmitDetail } from "./types";
import { useAnnotationSelectionDraft } from "./useAnnotationSelectionDraft";

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
  const theme = useDevtoolsTheme();
  const [annotationSelectionPluginVersion, setAnnotationSelectionPluginVersion] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [sendToActiveSession, setSendToActiveSession] = useState<boolean>(true);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState<string | null>(null);
  const commentTextareaReference = useRef<HTMLTextAreaElement | null>(null);
  const viewportPadding: number = readPixelValue(theme.spacing.sm);
  const annotationSelectionPlugin = useMemo(readActiveAnnotationSelectionPlugin, [annotationSelectionPluginVersion]);
  const trimmedComment: string = comment.trim();
  const {
    hoveredRectangle,
    isHoveredElementSelected,
    isSelectionMode,
    markerRenderModels,
    popupCoordinates,
    popupReference,
    resetSelectionDraft,
    selectedTargets,
  } = useAnnotationSelectionDraft({
    annotationSelectionPlugin,
    comment,
    isSubmitting,
    submissionErrorMessage,
    viewportPadding,
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

  const errorClassName: string = css(createSubmissionErrorStyle(theme));
  const overlayClassName: string = css(overlayStyle);
  const popupActionsClassName: string = css(popupActionsStyle);
  const popupHeaderClassName: string = css(popupHeaderStyle);
  const popupMetaClassName: string = css(popupMetaStyle);

  return (
    <div data-testid="AnnotationComposer">
      <div className={overlayClassName}>
        {isSelectionMode && hoveredRectangle !== null && !isHoveredElementSelected ? (
          <div
            className={css(createHoverHighlightStyle(theme, hoveredRectangle))}
            data-testid="AnnotationComposer--hover-highlight"
          />
        ) : null}
        {markerRenderModels.map((marker: IMarkerRenderModel) => {
          if (!marker.isVisible) {
            return null;
          }

          return (
            <div key={marker.markerNumber}>
              <div className={css(createSelectionHighlightStyle(theme, marker))} />
              <div className={css(createMarkerStyle(theme, marker))} data-testid="AnnotationComposer--marker">
                {marker.markerNumber}
              </div>
            </div>
          );
        })}
      </div>
      {selectedTargets.length > 0 && popupCoordinates !== null ? (
        <div
          ref={popupReference}
          data-testid="AnnotationComposer--popup"
          className={css(createPopupStyle(theme, popupCoordinates.left, popupCoordinates.top))}
          onClick={(event: React.MouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
          onMouseDown={(event: React.MouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
        >
          <div className={popupHeaderClassName}>
            <strong>Annotation draft</strong>
            <span className={popupMetaClassName}>
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
          <textarea
            ref={commentTextareaReference}
            data-testid="AnnotationComposer--comment"
            placeholder="Describe the change and refer to markers like #1, #2, #3…"
            rows={5}
            className={css(createTextareaStyle(theme))}
            value={comment}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              setComment(event.currentTarget.value);
            }}
          />
          {submissionErrorMessage !== null ? (
            <div className={errorClassName} data-testid="AnnotationComposer--error">
              {submissionErrorMessage}
            </div>
          ) : null}
          {canAppendToActiveAgentSession ? (
            <label className={css(createCheckboxLabelStyle(theme))}>
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
          <div className={popupActionsClassName}>
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
                endEnhancer="⌘ ↵"
                endEnhancerStyle={createShortcutBadgeStyle(theme)}
                endEnhancerStyleHover={shortcutBadgeHoverStyle}
                style={createSubmitButtonStyle(theme)}
                styleHover={createActionButtonHoverStyle(theme)}
                variant="primary"
                onClick={(): void => {
                  void submitDraft();
                }}
              >
                {isSubmitting ? "Submitting…" : `Run ${selectedAction.displayName}`}
              </Button>
            )}
            <Button
              disabled={isSubmitting}
              endEnhancer="Esc"
              endEnhancerStyle={createShortcutBadgeStyle(theme)}
              endEnhancerStyleHover={shortcutBadgeHoverStyle}
              style={createCancelButtonStyle(theme)}
              styleHover={createActionButtonHoverStyle(theme)}
              variant="secondary"
              onClick={cancelDraft}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
