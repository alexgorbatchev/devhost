import type { CSSObject } from "@emotion/css/create-instance";
import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import { Button, css, type IDevtoolsTheme, useDevtoolsTheme } from "../../shared";
import { DEVTOOLS_ROOT_ATTRIBUTE_NAME, DEVTOOLS_ROOT_ID } from "../../shared/constants";
import { isEventTargetTerminalKeyboardInput } from "../../shared/isEventTargetTerminalKeyboardInput";
import type { ITerminalSessionStartResult } from "../terminalSessions/types";
import { collectElementSnapshot, identifyElement } from "./collectElementSnapshot";
import { createAnnotationSubmitDetail } from "./createAnnotationSubmitDetail";
import { getElementSourceLocation } from "./getElementSourceLocation";
import { resolvePopupCoordinates } from "./resolvePopupCoordinates";
import { resolveAnnotationTarget } from "./resolveAnnotationTarget";
import type { IAnnotationSubmitDetail, ISelectedElementDraft } from "./types";

interface IAnnotationComposerProps {
  agentDisplayName: string;
  onSubmit: (detail: IAnnotationSubmitDetail) => Promise<ITerminalSessionStartResult>;
  stackName: string;
}

interface IMarkerRenderModel {
  elementHeight: number;
  elementLeft: number;
  elementTop: number;
  elementWidth: number;
  isVisible: boolean;
  markerLeft: number;
  markerNumber: number;
  markerTop: number;
}

interface ISelectionHighlightFrame {
  height: number;
  left: number;
  top: number;
  width: number;
}

const markerSize: number = 24;
const popupWidth: number = 320;
const selectionCursorStyleId: string = "devhost-annotation-cursor-style";
const selectionHighlightHorizontalPadding: number = 2;
const selectionHighlightVerticalPadding: number = 1;

export function AnnotationComposer(props: IAnnotationComposerProps): JSX.Element {
  const theme = useDevtoolsTheme();
  const [comment, setComment] = useState<string>("");
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [layoutVersion, setLayoutVersion] = useState<number>(0);
  const [popupHeight, setPopupHeight] = useState<number>(220);
  const [selectedElements, setSelectedElements] = useState<ISelectedElementDraft[]>([]);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState<string | null>(null);
  const commentTextareaReference = useRef<HTMLTextAreaElement | null>(null);
  const hoveredElementReference = useRef<HTMLElement | null>(null);
  const popupReference = useRef<HTMLDivElement | null>(null);
  const scheduledFrameReference = useRef<number | null>(null);
  const selectedElementsReference = useRef<ISelectedElementDraft[]>([]);
  const viewportPadding: number = readPixelValue(theme.spacing.sm);
  const trimmedComment: string = comment.trim();
  const hasActiveAnnotationInteraction: boolean = isSelectionMode || selectedElements.length > 0 || trimmedComment.length > 0;
  const hasDraft: boolean = selectedElements.length > 0 || trimmedComment.length > 0;

  const cancelDraft = useCallback((): void => {
    setComment("");
    setHoveredElement(null);
    hoveredElementReference.current = null;
    setIsSelectionMode(false);
    setIsSubmitting(false);
    selectedElementsReference.current = [];
    setSelectedElements([]);
    setSubmissionErrorMessage(null);
    setLayoutVersion((currentVersion: number): number => currentVersion + 1);
  }, []);

  const submitDraft = useCallback(async (): Promise<void> => {
    if (trimmedComment.length === 0 || selectedElements.length === 0 || isSubmitting) {
      return;
    }

    const markers = selectedElements.map(collectElementSnapshot);
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
      const submitResult: ITerminalSessionStartResult = await props.onSubmit(detail);

      if (submitResult.success) {
        cancelDraft();
        return;
      }

      setSubmissionErrorMessage(submitResult.errorMessage ?? `Failed to start the ${props.agentDisplayName} session.`);
    } catch (error) {
      setSubmissionErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }, [cancelDraft, isSubmitting, props, selectedElements, trimmedComment]);

  useEffect(() => {
    selectedElementsReference.current = selectedElements;
  }, [selectedElements]);

  useEffect(() => {
    if (!hasActiveAnnotationInteraction) {
      return;
    }

    const scheduleLayoutRefresh = (): void => {
      if (scheduledFrameReference.current !== null) {
        return;
      }

      scheduledFrameReference.current = window.requestAnimationFrame((): void => {
        scheduledFrameReference.current = null;
        setLayoutVersion((currentVersion: number): number => currentVersion + 1);
      });
    };

    window.addEventListener("resize", scheduleLayoutRefresh);
    window.addEventListener("scroll", scheduleLayoutRefresh, true);

    return () => {
      window.removeEventListener("resize", scheduleLayoutRefresh);
      window.removeEventListener("scroll", scheduleLayoutRefresh, true);

      if (scheduledFrameReference.current !== null) {
        window.cancelAnimationFrame(scheduledFrameReference.current);
        scheduledFrameReference.current = null;
      }
    };
  }, [hasActiveAnnotationInteraction]);

  useEffect(() => {
    if (!isSelectionMode) {
      setHoveredElement(null);
      hoveredElementReference.current = null;
      return;
    }

    const handleMouseMove = (event: MouseEvent): void => {
      const interactionTarget: HTMLElement | null = resolveInteractionTarget(event);

      if (interactionTarget === hoveredElementReference.current) {
        return;
      }

      hoveredElementReference.current = interactionTarget;
      setHoveredElement(interactionTarget);
    };

    document.addEventListener("mousemove", handleMouseMove, true);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      hoveredElementReference.current = null;
    };
  }, [isSelectionMode]);

  useEffect(() => {
    if (!isSelectionMode) {
      return;
    }

    const handleMouseDown = (event: MouseEvent): void => {
      if (isInteractionInsideDevtools(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const handleDocumentClick = async (event: MouseEvent): Promise<void> => {
      if (isInteractionInsideDevtools(event.target)) {
        return;
      }

      const interactionTarget: HTMLElement | null = resolveInteractionTarget(event);

      if (interactionTarget === null) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const currentSelections: ISelectedElementDraft[] = selectedElementsReference.current;

      if (
        currentSelections.some((selection: ISelectedElementDraft): boolean => selection.element === interactionTarget)
      ) {
        return;
      }

      const identifiedElement = identifyElement(interactionTarget);
      const selectedText: string | undefined = readSelectedText();
      const sourceLocation = await getElementSourceLocation(interactionTarget);
      const latestSelections: ISelectedElementDraft[] = selectedElementsReference.current;

      if (
        latestSelections.some((selection: ISelectedElementDraft): boolean => selection.element === interactionTarget)
      ) {
        return;
      }

      const nextSelection: ISelectedElementDraft = {
        element: interactionTarget,
        elementName: identifiedElement.name,
        elementPath: identifiedElement.path,
        markerNumber: latestSelections.length + 1,
        selectedText,
        sourceLocation,
      };
      const nextSelections: ISelectedElementDraft[] = [...latestSelections, nextSelection];

      selectedElementsReference.current = nextSelections;
      setSelectedElements(nextSelections);
      hoveredElementReference.current = interactionTarget;
      setHoveredElement(interactionTarget);
      setLayoutVersion((currentVersion: number): number => currentVersion + 1);
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [isSelectionMode]);

  useEffect(() => {
    const handleAltKeyDown = (event: KeyboardEvent): void => {
      if (isEventTargetTerminalKeyboardInput(event.target) || event.key !== "Alt") {
        return;
      }

      if (isSubmitting || doesEventTargetAcceptTextInput(event.target)) {
        return;
      }

      setIsSelectionMode(true);
    };
    const handleAltKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Alt") {
        return;
      }

      setIsSelectionMode(false);
    };

    document.addEventListener("keydown", handleAltKeyDown, true);
    document.addEventListener("keyup", handleAltKeyUp, true);

    return () => {
      document.removeEventListener("keydown", handleAltKeyDown, true);
      document.removeEventListener("keyup", handleAltKeyUp, true);
    };
  }, [isSubmitting]);

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
    if (!isSelectionMode) {
      return;
    }

    const handleWindowBlur = (): void => {
      setIsSelectionMode(false);
    };

    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [isSelectionMode]);

  useEffect(() => {
    if (!isSelectionMode) {
      removeSelectionCursorStyle();
      return;
    }

    const styleElement: HTMLStyleElement = document.createElement("style");
    styleElement.id = selectionCursorStyleId;
    styleElement.textContent = createSelectionCursorStyleText();
    document.head.append(styleElement);

    return () => {
      removeSelectionCursorStyle();
    };
  }, [isSelectionMode]);

  useEffect(() => {
    if (selectedElements.length !== 1) {
      return;
    }

    const animationFrameId: number = window.requestAnimationFrame((): void => {
      commentTextareaReference.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [selectedElements.length]);

  useEffect(() => {
    const popupElement: HTMLDivElement | null = popupReference.current;

    if (popupElement === null || selectedElements.length === 0) {
      return;
    }

    const animationFrameId: number = window.requestAnimationFrame((): void => {
      const nextPopupHeight: number = popupElement.getBoundingClientRect().height;

      setPopupHeight((currentPopupHeight: number): number => {
        return currentPopupHeight === nextPopupHeight ? currentPopupHeight : nextPopupHeight;
      });
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [comment, isSubmitting, layoutVersion, selectedElements.length, submissionErrorMessage]);


  const markerRenderModels: IMarkerRenderModel[] = useMemo((): IMarkerRenderModel[] => {
    void layoutVersion;

    return selectedElements.map((selection: ISelectedElementDraft): IMarkerRenderModel => {
      const elementRectangle: DOMRect = selection.element.getBoundingClientRect();
      const markerTop: number = clamp(
        elementRectangle.top - markerSize / 2,
        viewportPadding,
        window.innerHeight - markerSize - viewportPadding,
      );
      const markerLeft: number = clamp(
        elementRectangle.left - markerSize / 2,
        viewportPadding,
        window.innerWidth - markerSize - viewportPadding,
      );
      const isVisible: boolean =
        elementRectangle.width > 0 &&
        elementRectangle.height > 0 &&
        elementRectangle.bottom >= 0 &&
        elementRectangle.right >= 0 &&
        elementRectangle.top <= window.innerHeight &&
        elementRectangle.left <= window.innerWidth;

      return {
        elementHeight: elementRectangle.height,
        elementLeft: elementRectangle.left,
        elementTop: elementRectangle.top,
        elementWidth: elementRectangle.width,
        isVisible,
        markerLeft,
        markerNumber: selection.markerNumber,
        markerTop,
      };
    });
  }, [layoutVersion, selectedElements, viewportPadding]);
  const anchorSelection: ISelectedElementDraft | undefined = selectedElements[0];
  const anchorRectangle: DOMRect | null = useMemo((): DOMRect | null => {
    void layoutVersion;

    return anchorSelection?.element.getBoundingClientRect() ?? null;
  }, [anchorSelection, layoutVersion]);
  const popupCoordinates = useMemo(() => {
    if (anchorRectangle === null) {
      return null;
    }

    return resolvePopupCoordinates({
      anchorBottom: anchorRectangle.bottom,
      anchorLeft: anchorRectangle.left,
      anchorTop: anchorRectangle.top,
      popupHeight,
      popupWidth,
      viewportHeight: window.innerHeight,
      viewportPadding,
      viewportWidth: window.innerWidth,
    });
  }, [anchorRectangle, popupHeight, viewportPadding]);
  const hoveredRectangle: DOMRect | null = useMemo((): DOMRect | null => {
    void layoutVersion;

    return hoveredElement?.getBoundingClientRect() ?? null;
  }, [hoveredElement, layoutVersion]);
  const isHoveredElementSelected: boolean =
    hoveredElement !== null &&
    selectedElements.some((selection: ISelectedElementDraft): boolean => selection.element === hoveredElement);
  const errorClassName: string = css(createSubmissionErrorStyle(theme));
  const markerListClassName: string = css(markerListStyle);
  const markerListItemClassName: string = css(markerListItemStyle);
  const markerListTextClassName: string = css(markerListTextStyle);
  const overlayClassName: string = css(overlayStyle);
  const popupActionsClassName: string = css(popupActionsStyle);
  const popupHeaderClassName: string = css(popupHeaderStyle);
  const popupMetaClassName: string = css(popupMetaStyle);

  return (
    <div data-testid="AnnotationComposer">
      <div class={overlayClassName}>
        {isSelectionMode && hoveredRectangle !== null && !isHoveredElementSelected ? (
          <div
            class={css(createHoverHighlightStyle(theme, hoveredRectangle))}
            data-testid="AnnotationComposer--hover-highlight"
          />
        ) : null}
        {markerRenderModels.map((marker: IMarkerRenderModel) => {
          if (!marker.isVisible) {
            return null;
          }

          return (
            <div key={marker.markerNumber}>
              <div class={css(createSelectionHighlightStyle(theme, marker))} />
              <div class={css(createMarkerStyle(theme, marker))} data-testid="AnnotationComposer--marker">
                {marker.markerNumber}
              </div>
            </div>
          );
        })}
      </div>
      {selectedElements.length > 0 && popupCoordinates !== null ? (
        <div
          ref={popupReference}
          data-testid="AnnotationComposer--popup"
          class={css(createPopupStyle(theme, popupCoordinates.left, popupCoordinates.top))}
          onClick={(event: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
          onMouseDown={(event: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
            event.stopPropagation();
          }}
        >
          <div class={popupHeaderClassName}>
            <strong>Annotation draft</strong>
            <span class={popupMetaClassName}>
              {isSubmitting
                ? `Starting ${props.agentDisplayName} session…`
                : `${selectedElements.length} markers selected`}
            </span>
          </div>
          <ol class={markerListClassName} data-testid="AnnotationComposer--marker-list">
            {selectedElements.map((selection: ISelectedElementDraft) => {
              return (
                <li key={selection.markerNumber} class={markerListItemClassName}>
                  <span class={css(createMarkerPillStyle(theme))}>{selection.markerNumber}</span>
                  <span class={markerListTextClassName}>
                    <strong>#{selection.markerNumber}</strong> {selection.elementName}
                  </span>
                </li>
              );
            })}
          </ol>
          <textarea
            ref={commentTextareaReference}
            data-testid="AnnotationComposer--comment"
            placeholder="Describe the change and refer to markers like #1, #2, #3…"
            rows={5}
            class={css(createTextareaStyle(theme))}
            value={comment}
            onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>): void => {
              setComment(event.currentTarget.value);
            }}
          />
          {submissionErrorMessage !== null ? (
            <div class={errorClassName} data-testid="AnnotationComposer--error">
              {submissionErrorMessage}
            </div>
          ) : null}
          <div class={popupActionsClassName}>
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
              {isSubmitting ? `Starting ${props.agentDisplayName}…` : "Submit"}
            </Button>
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

const overlayStyle: CSSObject = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
};

const popupHeaderStyle: CSSObject = {
  display: "grid",
  gap: "4px",
};

const popupMetaStyle: CSSObject = {
  fontSize: "12px",
  opacity: 0.72,
};

function createSubmissionErrorStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    color: theme.colors.dangerForeground,
    fontSize: theme.fontSizes.sm,
    lineHeight: 1.4,
  };
}

const markerListStyle: CSSObject = {
  display: "grid",
  gap: "8px",
  listStyle: "none",
  margin: 0,
  maxHeight: "160px",
  overflow: "auto",
  padding: 0,
};

const markerListItemStyle: CSSObject = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "8px",
  alignItems: "center",
};

const markerListTextStyle: CSSObject = {
  alignSelf: "center",
  lineHeight: 1.35,
};

const popupActionsStyle: CSSObject = {
  display: "flex",
  justifyContent: "flex-start",
  gap: "8px",
};

const shortcutBadgeHoverStyle: CSSObject = {
  color: "rgba(255, 255, 255, 1)",
};

const actionButtonMutedForeground: string = "rgba(255, 255, 255, 0.6)";
const actionButtonShortcutBackground: string = "rgba(255, 255, 255, 0.1)";
const actionButtonSubmitForeground: string = "rgba(255, 255, 255, 1)";
const actionButtonHoverRing: string = "rgba(255, 255, 255, 0.22)";

function createActionButtonHoverStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${actionButtonSubmitForeground}`,
    boxShadow: `0 0 0 1px ${actionButtonHoverRing}, ${theme.shadows.floating}`,
    color: actionButtonSubmitForeground,
  };
}

function createCancelButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${theme.colors.border}`,
    boxShadow: theme.shadows.floating,
    color: actionButtonMutedForeground,
  };
}

function createShortcutBadgeStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    minWidth: "32px",
    padding: `0 ${theme.spacing.xs}`,
    border: "none",
    borderRadius: theme.radii.sm,
    background: actionButtonShortcutBackground,
    color: actionButtonMutedForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: "80%",
    lineHeight: 1.6,
    boxSizing: "border-box",
  };
}

function createSubmitButtonStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    border: `1px solid ${theme.colors.selectionBorder}`,
    boxShadow: theme.shadows.floating,
    background: theme.colors.selectionBackground,
    color: actionButtonSubmitForeground,
  };
}

function createHoverHighlightStyle(theme: IDevtoolsTheme, hoveredRectangle: DOMRect): CSSObject {
  return createSelectionHighlightFrameStyle(theme, {
    height: hoveredRectangle.height,
    left: hoveredRectangle.left,
    top: hoveredRectangle.top,
    width: hoveredRectangle.width,
  });
}

function createSelectionHighlightStyle(theme: IDevtoolsTheme, marker: IMarkerRenderModel): CSSObject {
  return createSelectionHighlightFrameStyle(theme, {
    height: marker.elementHeight,
    left: marker.elementLeft,
    top: marker.elementTop,
    width: marker.elementWidth,
  });
}

function createSelectionHighlightFrameStyle(
  theme: IDevtoolsTheme,
  selectionHighlightFrame: ISelectionHighlightFrame,
): CSSObject {
  return {
    position: "fixed",
    top: selectionHighlightFrame.top - selectionHighlightVerticalPadding,
    left: selectionHighlightFrame.left - selectionHighlightHorizontalPadding,
    width: selectionHighlightFrame.width + selectionHighlightHorizontalPadding * 2,
    height: selectionHighlightFrame.height + selectionHighlightVerticalPadding * 2,
    boxSizing: "border-box",
    border: `2px solid ${theme.colors.selectionBorder}`,
    borderRadius: theme.radii.sm,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createMarkerStyle(theme: IDevtoolsTheme, marker: IMarkerRenderModel): CSSObject {
  return {
    position: "fixed",
    top: marker.markerTop,
    left: marker.markerLeft,
    width: `${markerSize}px`,
    height: `${markerSize}px`,
    display: "grid",
    placeItems: "center",
    borderRadius: theme.radii.pill,
    background: theme.colors.accentBackground,
    color: theme.colors.accentForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    fontWeight: 700,
    boxShadow: theme.shadows.floating,
    pointerEvents: "none",
    zIndex: theme.zIndices.floating,
  };
}

function createPopupStyle(theme: IDevtoolsTheme, left: number, top: number): CSSObject {
  return {
    position: "fixed",
    top,
    left,
    width: `min(${popupWidth}px, calc(100vw - ${theme.spacing.sm} - ${theme.spacing.sm}))`,
    display: "grid",
    gap: theme.spacing.xs,
    padding: theme.spacing.sm,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.md,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.sm,
    boxShadow: theme.shadows.popup,
    pointerEvents: "auto",
    zIndex: theme.zIndices.floating,
  };
}

function createTextareaStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    width: "100%",
    minHeight: "96px",
    resize: "none",
    boxSizing: "border-box",
    padding: theme.spacing.xs,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: theme.radii.sm,
    background: theme.colors.background,
    color: theme.colors.foreground,
    fontFamily: theme.fontFamilies.body,
    fontSize: theme.fontSizes.sm,
  };
}

function createMarkerPillStyle(theme: IDevtoolsTheme): CSSObject {
  return {
    minWidth: `${markerSize}px`,
    height: `${markerSize}px`,
    display: "grid",
    placeItems: "center",
    alignSelf: "start",
    borderRadius: theme.radii.pill,
    background: theme.colors.accentBackground,
    color: theme.colors.accentForeground,
    fontFamily: theme.fontFamilies.monospace,
    fontSize: theme.fontSizes.sm,
    fontWeight: 700,
  };
}

function resolveInteractionTarget(event: MouseEvent): HTMLElement | null {
  if (isInteractionInsideDevtools(event.target)) {
    return null;
  }

  return resolveAnnotationTarget(event.clientX, event.clientY);
}

function readSelectedText(): string | undefined {
  const selection: Selection | null = window.getSelection();
  const selectedText: string = selection?.toString().trim() ?? "";

  if (selectedText.length === 0) {
    return undefined;
  }

  return selectedText.slice(0, 500);
}

function isInteractionInsideDevtools(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return target.closest(`[${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], #${DEVTOOLS_ROOT_ID}`) !== null;
}

function doesEventTargetAcceptTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

function createSelectionCursorStyleText(): string {
  // Intentionally document-scoped: selection mode targets host-page elements outside the devtools shadow root,
  // so the cursor affordance must temporarily apply beyond the injected UI boundary.
  return `
    body * {
      cursor: crosshair !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}], [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] * {
      cursor: default !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] button,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] button *,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] [role="button"],
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] [role="button"] * {
      cursor: pointer !important;
    }
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] textarea,
    [${DEVTOOLS_ROOT_ATTRIBUTE_NAME}] input[type="text"] {
      cursor: text !important;
    }
  `;
}

function removeSelectionCursorStyle(): void {
  document.getElementById(selectionCursorStyleId)?.remove();
}

function readPixelValue(value: string): number {
  const parsedValue: number = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
