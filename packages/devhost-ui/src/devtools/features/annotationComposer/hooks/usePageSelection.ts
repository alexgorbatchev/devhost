import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isEventTargetEditingSurface } from "../../../shared/isEventTargetEditingSurface";

import { selectionCursorStyleId, type ISelectedAnnotationTarget } from "../annotationComposerModels";
import { readActiveAnnotationSelectionPlugin } from "../annotationSelectionPluginRegistry";
import type { IRectSnapshot } from "../types";
import {
  isInteractionInsideDevtools,
  removeSelectionCursorStyle,
  resolveAnnotationSelectionCandidate,
} from "../annotationComposerUtils";
import { isAnnotationControlsEvent } from "../isAnnotationControlsEvent";
import type { IAnnotationSelectionCandidate } from "../annotationSelectionPluginTypes";

type AnnotationSelectionPlugin = ReturnType<typeof readActiveAnnotationSelectionPlugin>;

interface IUsePageSelectionParams {
  annotationSelectionPlugin: AnnotationSelectionPlugin;
  isDisabled: boolean;
}

interface IUsePageSelectionResult {
  hoveredLabel: string | null;
  hoveredRectangle: IRectSnapshot | null;
  isHoveredElementSelected: boolean;
  isSelectionMode: boolean;
  clearSelection: () => void;
  removeSelection: (id: string) => void;
  startSelection: () => void;
  stopSelection: () => void;
  selectedTargets: ISelectedAnnotationTarget[];
}

export function usePageSelection({
  annotationSelectionPlugin,
  isDisabled,
}: IUsePageSelectionParams): IUsePageSelectionResult {
  const [hoveredCandidate, setHoveredCandidate] = useState<IAnnotationSelectionCandidate | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [layoutVersion, setLayoutVersion] = useState<number>(0);
  const [selectedTargets, setSelectedTargets] = useState<ISelectedAnnotationTarget[]>([]);
  const hoveredCandidateReference = useRef<IAnnotationSelectionCandidate | null>(null);
  const selectionResolutionSequenceReference = useRef<number>(0);
  const selectionRevisionReference = useRef<number>(0);
  const scheduledFrameReference = useRef<number | null>(null);
  const selectedTargetsReference = useRef<ISelectedAnnotationTarget[]>([]);
  const hasActiveAnnotationInteraction: boolean = isSelectionMode || selectedTargets.length > 0;

  const clearSelection = useCallback((): void => {
    selectionRevisionReference.current += 1;
    selectionResolutionSequenceReference.current += 1;
    hoveredCandidateReference.current = null;
    selectedTargetsReference.current = [];
    setHoveredCandidate(null);
    setIsSelectionMode(false);
    setSelectedTargets([]);
    setLayoutVersion((currentVersion: number): number => currentVersion + 1);
  }, []);

  const startSelection = useCallback((): void => {
    if (!isDisabled) setIsSelectionMode(true);
  }, [isDisabled]);
  const removeSelection = useCallback((id: string): void => {
    selectionRevisionReference.current += 1;
    const next = selectedTargetsReference.current
      .filter((target) => target.candidate.id !== id)
      .map((target, index) => ({ ...target, markerNumber: index + 1 }));
    selectedTargetsReference.current = next;
    setSelectedTargets(next);
  }, []);
  const stopSelection = useCallback((): void => {
    setIsSelectionMode(false);
  }, []);

  useEffect(() => {
    if (isDisabled) {
      setIsSelectionMode(false);
    }
    return () => {
      selectionRevisionReference.current += 1;
    };
  }, [annotationSelectionPlugin, isDisabled]);

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
      if (isAnnotationControlsEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const handleDocumentClick = async (event: MouseEvent): Promise<void> => {
      if (isAnnotationControlsEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const revision = selectionRevisionReference.current;
      const selectionCandidate = await resolveAnnotationSelectionCandidate(annotationSelectionPlugin, event, "select");

      if (selectionCandidate === null || revision !== selectionRevisionReference.current) {
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

      const nextSelection: ISelectedAnnotationTarget = {
        candidate: selectionCandidate,
        markerNumber: currentSelections.length + 1,
      };
      const nextSelections: ISelectedAnnotationTarget[] = [...currentSelections, nextSelection];

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
      selectionRevisionReference.current += 1;
    };
  }, [annotationSelectionPlugin, isSelectionMode]);

  useEffect(() => {
    const handleAltKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Alt") {
        return;
      }

      if (isDisabled || isEventTargetEditingSurface(event.composedPath().at(0) ?? event.target)) {
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
  }, [isDisabled]);

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
    hoveredLabel: hoveredCandidate?.label ?? null,
    hoveredRectangle,
    isHoveredElementSelected,
    isSelectionMode,
    clearSelection,
    removeSelection,
    startSelection,
    stopSelection,
    selectedTargets,
  };
}
