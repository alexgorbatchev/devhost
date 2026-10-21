import { DensityProvider, PortalProvider } from "@alexgorbatchev/shadcn";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type JSX, type RefObject } from "react";
import { AnnotationSelectionOverlay } from "../../annotationComposer/components/AnnotationSelectionOverlay";
import { AnnotationSelectionHint } from "../../annotationComposer/components/AnnotationSelectionHint";
import {
  readActiveAnnotationSelectionPlugin,
  subscribeToAnnotationSelectionPlugins,
} from "../../annotationComposer/annotationSelectionPluginRegistry";
import { usePageSelection } from "../../annotationComposer/hooks/usePageSelection";
import { AnnotationCanvas } from "../../visualAnnotations/components/AnnotationCanvas";
import { captureAnnotatedTab } from "../../visualAnnotations/captureAnnotatedTab";
import type { AnnotationShapeKind, IAnnotationShape } from "../../visualAnnotations/types";
import type { ChatBeforeSend } from "../types";
import { preparePageChatSend } from "../preparePageChatSend";
import { useAgentChat } from "../hooks/useAgentChat";
import { AgentChatPanel } from "./AgentChatPanel";
import { PageAnnotationToolbar } from "./PageAnnotationToolbar";
import { PageContextList } from "./PageContextList";
import { useTabShare } from "../../visualAnnotations/hooks/useTabShare";
import type { DevtoolsSettingsStore } from "../../../shared/types";

interface IPageChatProps {
  settingsStore?: DevtoolsSettingsStore;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isSelectionEnabled: boolean;
  rootReference: RefObject<HTMLDivElement | null>;
}

export function PageChat({
  isOpen,
  onOpenChange,
  isSelectionEnabled,
  rootReference,
  settingsStore,
}: IPageChatProps): JSX.Element {
  const sharing = useTabShare();
  // Portals inherit from this interactive surface rather than the passive full-viewport devtools root.
  const portalReference = useRef<HTMLDivElement | null>(null);
  const [sessionPageURL] = useState(() => window.location.href);
  const plugin = useSyncExternalStore(subscribeToAnnotationSelectionPlugins, readActiveAnnotationSelectionPlugin);
  const [tool, setTool] = useState<AnnotationShapeKind | null>(null);
  const [shapes, setShapes] = useState<IAnnotationShape[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const captureReference = useRef<AbortController | null>(null);
  const selection = usePageSelection({
    annotationSelectionPlugin: plugin,
    isDisabled: !isSelectionEnabled || tool !== null || isCapturing,
  });
  const { selectedTargets, stopSelection, clearSelection, removeSelection, isSelectionMode } = selection;
  useEffect(() => () => captureReference.current?.abort(), []);
  useEffect(() => {
    if (selectedTargets.length > 0) onOpenChange(true);
  }, [onOpenChange, selectedTargets.length]);
  useEffect(() => {
    const stop = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && (tool !== null || isSelectionMode)) {
        setTool(null);
        stopSelection();
      }
    };
    document.addEventListener("keydown", stop);
    return () => document.removeEventListener("keydown", stop);
  }, [isSelectionMode, stopSelection, tool]);

  const beforeSend: ChatBeforeSend = useCallback(
    (text) =>
      preparePageChatSend({
        text,
        title: document.title,
        url: window.location.href,
        targets: selectedTargets,
        shapes,
        capture: async () => {
          const controller = new AbortController();
          captureReference.current?.abort();
          captureReference.current = controller;
          try {
            const root = rootReference.current;
            if (root === null) throw new Error("Chat is no longer mounted.");
            const capture = captureAnnotatedTab({
              root,
              document,
              mediaDevices: navigator.mediaDevices,
              signal: controller.signal,
              sharedStream: sharing.stream,
              selectedTargets,
              shapes,
            });
            setIsCapturing(true);
            stopSelection();
            setTool(null);
            return await capture;
          } finally {
            if (captureReference.current === controller) {
              captureReference.current = null;
              setIsCapturing(false);
            }
          }
        },
      }),
    [rootReference, selectedTargets, stopSelection, shapes, sharing.stream],
  );
  const clearContext = useCallback((): void => {
    clearSelection();
    setShapes([]);
    setTool(null);
  }, [clearSelection]);
  const clearSentContext = useCallback((): void => {
    for (const target of selectedTargets) removeSelection(target.candidate.id);
    const sentIds = new Set(shapes.map((shape) => shape.id));
    setShapes((current) => current.filter((shape) => !sentIds.has(shape.id)));
  }, [selectedTargets, removeSelection, shapes]);
  const chat = useAgentChat({ pageURL: sessionPageURL, beforeSend, onSent: clearSentContext, settingsStore });
  const isContextDisabled = isCapturing || chat.isPreparing;
  return (
    <PortalProvider container={portalReference}>
      <div ref={portalReference} className="pointer-events-auto relative z-(--devhost-z-modal)" />
      <DensityProvider density="compact">
        <AnnotationSelectionHint
          isVisible={isSelectionMode || tool !== null}
          text={tool ? `Drag To Draw A ${tool}. Esc To Cancel.` : "Click Elements To Add Context. Esc To Finish."}
        />
        <AnnotationSelectionOverlay {...selection} />
        <AnnotationCanvas
          shapes={shapes}
          tool={tool}
          isDisabled={isContextDisabled || isSelectionMode}
          onMove={(moved) => setShapes((current) => current.map((shape) => (shape.id === moved.id ? moved : shape)))}
          onDraw={(shape) => {
            setShapes((current) => [...current, shape]);
            setTool(null);
            onOpenChange(true);
          }}
        />
        {isSelectionEnabled && (isOpen || isSelectionMode || tool !== null) ? (
          <PageAnnotationToolbar
            tool={tool}
            isSelecting={isSelectionMode}
            isDisabled={isContextDisabled}
            canUndo={shapes.length > 0}
            onUndo={() => setShapes((current) => current.slice(0, -1))}
            onToolChange={(next) => {
              setTool(next === "select" ? null : next);
              if (next === "select") selection.startSelection();
              else stopSelection();
            }}
          />
        ) : null}
        <AgentChatPanel
          sharing={sharing}
          chat={chat}
          isOpen={isOpen}
          onClose={() => {
            stopSelection();
            setTool(null);
            onOpenChange(false);
          }}
        >
          <PageContextList
            targets={selectedTargets}
            shapes={shapes}
            isDisabled={isContextDisabled}
            onRemoveTarget={selection.removeSelection}
            onRemoveShape={(id) => setShapes((current) => current.filter((shape) => shape.id !== id))}
            onClear={clearContext}
          />
        </AgentChatPanel>
      </DensityProvider>
    </PortalProvider>
  );
}
