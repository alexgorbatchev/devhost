import { Button, DensityProvider, PortalProvider } from "@alexgorbatchev/shadcn";
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

interface IPageChatProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  isSelectionEnabled: boolean;
  rootReference: RefObject<HTMLDivElement | null>;
}

export function PageChat({ isOpen, onOpenChange, isSelectionEnabled, rootReference }: IPageChatProps): JSX.Element {
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
  const { selectedTargets, stopSelection, isSelectionMode } = selection;
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
    [rootReference, selectedTargets, stopSelection, shapes],
  );
  const chat = useAgentChat({ pageURL: sessionPageURL, beforeSend });
  const hasContext = selectedTargets.length > 0 || shapes.length > 0;
  const changeTool = (next: AnnotationShapeKind): void => {
    stopSelection();
    setTool(tool === next ? null : next);
  };
  return (
    <PortalProvider container={rootReference}>
      <DensityProvider density="compact">
        <AnnotationSelectionHint isVisible={isSelectionMode && selectedTargets.length === 0} />
        <AnnotationSelectionOverlay {...selection} />
        <AnnotationCanvas
          shapes={shapes}
          tool={tool}
          onDraw={(shape) => {
            setShapes((current) => [...current, shape]);
            setTool(null);
            onOpenChange(true);
          }}
        />
        <AgentChatPanel
          chat={chat}
          isOpen={isOpen}
          onClose={() => {
            stopSelection();
            setTool(null);
            onOpenChange(false);
          }}
        >
          {isSelectionEnabled ? (
            <div className="shrink-0 border-b border-border p-2">
              <div className="flex flex-wrap gap-1" aria-label="Page annotation tools" role="group">
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={isSelectionMode}
                  disabled={isCapturing}
                  onClick={() => {
                    setTool(null);
                    if (isSelectionMode) stopSelection();
                    else selection.startSelection();
                  }}
                >
                  Select element
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={tool === "arrow"}
                  disabled={isCapturing}
                  onClick={() => changeTool("arrow")}
                >
                  Arrow
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={tool === "line"}
                  disabled={isCapturing}
                  onClick={() => changeTool("line")}
                >
                  Line
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-pressed={tool === "box"}
                  disabled={isCapturing}
                  onClick={() => changeTool("box")}
                >
                  Box
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isCapturing || shapes.length === 0}
                  onClick={() => setShapes((current) => current.slice(0, -1))}
                >
                  Undo drawing
                </Button>
              </div>
              {isSelectionMode || tool !== null ? (
                <p role="status" className="pt-1 text-muted-foreground">
                  {tool === null ? "Click elements to add context." : `Drag on the page to draw a ${tool}.`} Press Esc
                  to interact with the page.
                </p>
              ) : null}
              {hasContext ? (
                <section aria-label="Page context" className="mt-2 max-h-28 overflow-auto">
                  <ul>
                    {selectedTargets.map((target) => (
                      <li key={target.candidate.id}>
                        #{target.markerNumber} {target.candidate.label}
                      </li>
                    ))}
                    {shapes.map((shape, index) => (
                      <li key={shape.id}>
                        {index + 1}. {shape.kind}
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">
                    Sending includes this context and asks you to share this tab for a snapshot.
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isCapturing}
                    onClick={() => {
                      selection.clearSelection();
                      setShapes([]);
                      setTool(null);
                    }}
                  >
                    Clear page context
                  </Button>
                </section>
              ) : null}
            </div>
          ) : null}
        </AgentChatPanel>
      </DensityProvider>
    </PortalProvider>
  );
}
