import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { isEventTargetTerminalKeyboardInput } from "../../shared/isEventTargetTerminalKeyboardInput";

import {
  markerSize,
  popupWidth,
  selectionCursorStyleId,
  type IMarkerRenderModel,
  type ISelectedAnnotationTarget,
} from "./annotationComposerModels";
import { readActiveAnnotationSelectionPlugin } from "./annotationSelectionPluginRegistry";
import { resolvePopupCoordinates, type IPopupCoordinates } from "./resolvePopupCoordinates";
import type { IRectSnapshot } from "./types";
import {
  clamp,
  doesEventTargetAcceptTextInput,
  isInteractionInsideDevtools,
  removeSelectionCursorStyle,
  resolveAnnotationSelectionCandidate,
} from "./annotationComposerUtils";
import type { IAnnotationSelectionCandidate } from "./annotationSelectionPluginTypes";

type AnnotationSelectionPlugin = ReturnType<typeof readActiveAnnotationSelectionPlugin>;

interface IUseAnnotationSelectionDraftParams {
  annotationSelectionPlugin: AnnotationSelectionPlugin;
  comment: string;
  isSubmitting: boolean;
  submissionErrorMessage: string | null;
  viewportPadding: number;
}

interface IUseAnnotationSelectionDraftResult {
  hoveredRectangle: IRectSnapshot | null;
  isHoveredElementSelected: boolean;
  isSelectionMode: boolean;
  markerRenderModels: IMarkerRenderModel[];
  popupCoordinates: IPopupCoordinates | null;
  popupReference: RefObject<HTMLDivElement | null>;
  resetSelectionDraft: () => void;
  selectedTargets: ISelectedAnnotationTarget[];
}

export function useAnnotationSelectionDraft({
  annotationSelectionPlugin,
  comment,
  isSubmitting,
  submissionErrorMessage,
  viewportPadding,
}: IUseAnnotationSelectionDraftParams): IUseAnnotationSelectionDraftResult {
  const [hoveredCandidate, setHoveredCandidate] = useState<IAnnotationSelectionCandidate | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [layoutVersion, setLayoutVersion] = useState<number>(0);
  const [popupHeight, setPopupHeight] = useState<number>(220);
  const [selectedTargets, setSelectedTargets] = useState<ISelectedAnnotationTarget[]>([]);
  const hoveredCandidateReference = useRef<IAnnotationSelectionCandidate | null>(null);
  const popupReference = useRef<HTMLDivElement | null>(null);
  const selectionResolutionSequenceReference = useRef<number>(0);
  const scheduledFrameReference = useRef<number | null>(null);
  const selectedTargetsReference = useRef<ISelectedAnnotationTarget[]>([]);
  const hasActiveAnnotationInteraction: boolean =
    isSelectionMode || selectedTargets.length > 0 || comment.trim().length > 0;

  const resetSelectionDraft = useCallback((): void => {
    selectionResolutionSequenceReference.current += 1;
    hoveredCandidateReference.current = null;
    selectedTargetsReference.current = [];
    setHoveredCandidate(null);
    setIsSelectionMode(false);
    setSelectedTargets([]);
    setLayoutVersion((currentVersion: number): number => currentVersion + 1);
  }, []);

  useEffect(() => {
    selectedTargetsReference.current = selectedTargets;
  }, [selectedTargets]);

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
      selectionResolutionSequenceReference.current += 1;
      setHoveredCandidate(null);
      hoveredCandidateReference.current = null;
      return;
    }

    const handleMouseMove = (event: MouseEvent): void => {
      const resolutionSequence: number = ++selectionResolutionSequenceReference.current;

      const updateHoveredCandidate = async (): Promise<void> => {
        const nextCandidate: IAnnotationSelectionCandidate | null = await resolveAnnotationSelectionCandidate(
          annotationSelectionPlugin,
          event,
          "hover",
        );

        if (selectionResolutionSequenceReference.current !== resolutionSequence) {
          return;
        }

        if (nextCandidate?.id === hoveredCandidateReference.current?.id) {
          return;
        }

        hoveredCandidateReference.current = nextCandidate;
        setHoveredCandidate(nextCandidate);
      };

      void updateHoveredCandidate();
    };

    document.addEventListener("mousemove", handleMouseMove, true);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove, true);
      selectionResolutionSequenceReference.current += 1;
      hoveredCandidateReference.current = null;
    };
  }, [annotationSelectionPlugin, isSelectionMode]);

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

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const selectionCandidate = await resolveAnnotationSelectionCandidate(annotationSelectionPlugin, event, "select");

      if (selectionCandidate === null) {
        return;
      }

      const currentSelections: ISelectedAnnotationTarget[] = selectedTargetsReference.current;

      if (
        currentSelections.some((selection: ISelectedAnnotationTarget): boolean => {
          return selection.candidate.id === selectionCandidate.id;
        })
      ) {
        return;
      }

      const latestSelections: ISelectedAnnotationTarget[] = selectedTargetsReference.current;

      if (
        latestSelections.some((selection: ISelectedAnnotationTarget): boolean => {
          return selection.candidate.id === selectionCandidate.id;
        })
      ) {
        return;
      }

      const nextSelection: ISelectedAnnotationTarget = {
        candidate: selectionCandidate,
        markerNumber: latestSelections.length + 1,
      };
      const nextSelections: ISelectedAnnotationTarget[] = [...latestSelections, nextSelection];

      selectedTargetsReference.current = nextSelections;
      setSelectedTargets(nextSelections);
      hoveredCandidateReference.current = selectionCandidate;
      setHoveredCandidate(selectionCandidate);
      setLayoutVersion((currentVersion: number): number => currentVersion + 1);
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("click", handleDocumentClick, true);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("click", handleDocumentClick, true);
    };
  }, [annotationSelectionPlugin, isSelectionMode]);

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
      removeSelectionCursorStyle(selectionCursorStyleId);
      return;
    }

    const cursorStyleText: string | null = annotationSelectionPlugin.getCursorStyleText?.() ?? null;

    if (cursorStyleText === null) {
      removeSelectionCursorStyle(selectionCursorStyleId);
      return;
    }

    const styleElement: HTMLStyleElement = document.createElement("style");
    styleElement.id = selectionCursorStyleId;
    styleElement.textContent = cursorStyleText;
    document.head.append(styleElement);

    return () => {
      removeSelectionCursorStyle(selectionCursorStyleId);
    };
  }, [annotationSelectionPlugin, isSelectionMode]);

  useEffect(() => {
    const popupElement: HTMLDivElement | null = popupReference.current;

    if (popupElement === null || selectedTargets.length === 0) {
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
  }, [comment, isSubmitting, submissionErrorMessage, layoutVersion, selectedTargets.length]);

  const markerRenderModels: IMarkerRenderModel[] = useMemo((): IMarkerRenderModel[] => {
    void layoutVersion;

    return selectedTargets.flatMap((selection: ISelectedAnnotationTarget): IMarkerRenderModel[] => {
      const elementRectangle: IRectSnapshot | null = selection.candidate.readRect();

      if (elementRectangle === null) {
        return [];
      }

      const markerTop: number = clamp(
        elementRectangle.y - markerSize / 2,
        viewportPadding,
        window.innerHeight - markerSize - viewportPadding,
      );
      const markerLeft: number = clamp(
        elementRectangle.x - markerSize / 2,
        viewportPadding,
        window.innerWidth - markerSize - viewportPadding,
      );
      const isVisible: boolean =
        elementRectangle.width > 0 &&
        elementRectangle.height > 0 &&
        elementRectangle.y + elementRectangle.height >= 0 &&
        elementRectangle.x + elementRectangle.width >= 0 &&
        elementRectangle.y <= window.innerHeight &&
        elementRectangle.x <= window.innerWidth;

      return [
        {
          elementHeight: elementRectangle.height,
          elementLeft: elementRectangle.x,
          elementTop: elementRectangle.y,
          elementWidth: elementRectangle.width,
          isVisible,
          markerLeft,
          markerNumber: selection.markerNumber,
          markerTop,
        },
      ];
    });
  }, [layoutVersion, selectedTargets, viewportPadding]);
  const anchorSelection: ISelectedAnnotationTarget | undefined = selectedTargets[0];
  const anchorRectangle: IRectSnapshot | null = useMemo((): IRectSnapshot | null => {
    void layoutVersion;

    return anchorSelection?.candidate.readRect() ?? null;
  }, [anchorSelection, layoutVersion]);
  const popupCoordinates: IPopupCoordinates | null = useMemo((): IPopupCoordinates | null => {
    if (anchorRectangle === null) {
      return null;
    }

    return resolvePopupCoordinates({
      anchorBottom: anchorRectangle.y + anchorRectangle.height,
      anchorLeft: anchorRectangle.x,
      anchorTop: anchorRectangle.y,
      popupHeight,
      popupWidth,
      viewportHeight: window.innerHeight,
      viewportPadding,
      viewportWidth: window.innerWidth,
    });
  }, [anchorRectangle, popupHeight, viewportPadding]);
  const hoveredRectangle: IRectSnapshot | null = useMemo((): IRectSnapshot | null => {
    void layoutVersion;

    return hoveredCandidate?.readRect() ?? null;
  }, [hoveredCandidate, layoutVersion]);
  const isHoveredElementSelected: boolean =
    hoveredCandidate !== null &&
    selectedTargets.some((selection: ISelectedAnnotationTarget): boolean => {
      return selection.candidate.id === hoveredCandidate.id;
    });

  return {
    hoveredRectangle,
    isHoveredElementSelected,
    isSelectionMode,
    markerRenderModels,
    popupCoordinates,
    popupReference,
    resetSelectionDraft,
    selectedTargets,
  };
}
