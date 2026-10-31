import { DensityProvider, PortalProvider } from "@alexgorbatchev/shadcn";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type RefObject,
} from "react";
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
import type { ChatBeforeSend, IChatReceipt } from "../types";
import { isChatRequestSettled } from "../isChatRequestSettled";
import { preparePageChatSend } from "../preparePageChatSend";
import { useAgentChat } from "../hooks/useAgentChat";
import { useChatComposerFocus } from "../hooks/useChatComposerFocus";
import { AgentChatPanel } from "./AgentChatPanel";
import { ChatTargetToggle } from "./ChatTargetToggle";
import { PageAnnotationToolbar } from "./PageAnnotationToolbar";
import { PageContextList } from "./PageContextList";
import { useTabShare } from "../../visualAnnotations/hooks/useTabShare";
import type { DevtoolsPosition } from "../../../shared/devtoolsConfig";
import type { ChatTarget, DevtoolsSettingsStore } from "../../../shared/types";
import { AnnotationTopLayer } from "../../../shared/components/AnnotationTopLayer";
import { useScreenshotSelection } from "../../visualAnnotations/hooks/useScreenshotSelection";

const ScreenshotShareDialog = lazy(() =>
  import("../../visualAnnotations/components/ScreenshotShareDialog").then((module) => ({
    default: module.ScreenshotShareDialog,
  })),
);

interface IPageChatProps {
  settingsStore?: DevtoolsSettingsStore;
  target: ChatTarget;
  /** Offers the devhost target beside the project; absent when devhost serves no source checkout. */
  onTargetChange?: (target: ChatTarget) => void;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onBusyChange?: (isBusy: boolean) => void;
  isSelectionEnabled: boolean;
  rootReference: RefObject<HTMLDivElement | null>;
  /** A message to send as soon as the conversation is ready. */
  requestedMessage?: string;
  onRequestedMessageTaken?: (receipt: Promise<IChatReceipt | null>) => void;
  /** A sent request whose outcome the caller is waiting for, which can outlive the page that sent it. */
  trackedRequest?: IChatReceipt | null;
  onTrackedRequestSettled?: () => void;
  toolbarPosition?: DevtoolsPosition;
  toolbarEdgeInset?: number | null;
}

export function PageChat({
  isOpen,
  onOpenChange,
  onBusyChange,
  isSelectionEnabled,
  rootReference,
  settingsStore,
  target,
  onTargetChange,
  requestedMessage,
  onRequestedMessageTaken,
  trackedRequest,
  onTrackedRequestSettled,
  toolbarPosition,
  toolbarEdgeInset,
}: IPageChatProps): JSX.Element {
  const sharing = useTabShare();
  const screenshotSelection = useScreenshotSelection(sharing.stream);
  const [shouldIncludeSnapshot, setShouldIncludeSnapshot] = useState(true);
  // Portals inherit from this interactive surface rather than the passive full-viewport devtools root.
  const portalReference = useRef<HTMLDivElement | null>(null);
  const annotationReference = useRef<HTMLDivElement | null>(null);
  const marksReference = useRef<HTMLDivElement | null>(null);
  // Chatting in the devhost checkout makes devhost's own UI the subject: its surfaces become selectable and
  // drawings cover them. Otherwise the page is the subject, and devhost's UI stays usable above its annotations.
  const isAnnotatingDevhost: boolean = target === "devhost";
  const [sessionPageURL] = useState(() => window.location.href);
  const plugin = useSyncExternalStore(subscribeToAnnotationSelectionPlugins, readActiveAnnotationSelectionPlugin);
  const [tool, setTool] = useState<AnnotationShapeKind | null>(null);
  const [shapes, setShapes] = useState<IAnnotationShape[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const captureReference = useRef<AbortController | null>(null);
  const selection = usePageSelection({
    annotationSelectionPlugin: plugin,
    canSelectDevtools: isAnnotatingDevhost,
    isDisabled: !isSelectionEnabled || tool !== null || isCapturing,
  });
  const { selectedTargets, stopSelection, clearSelection, removeSelection, isSelectionMode } = selection;
  useEffect(() => () => captureReference.current?.abort(), [sharing.stream]);
  useEffect(() => {
    if (selectedTargets.length > 0) onOpenChange(true);
  }, [onOpenChange, selectedTargets.length]);
  useEffect(() => {
    const stop = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && (tool !== null || isSelectionMode)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setTool(null);
        stopSelection();
      }
    };
    // Captured: keys typed into devtools fields, such as the composer, end their propagation at the shadow root.
    document.addEventListener("keydown", stop, true);
    return () => document.removeEventListener("keydown", stop, true);
  }, [isSelectionMode, stopSelection, tool]);

  const beforeSend: ChatBeforeSend = useCallback(
    (text) =>
      preparePageChatSend({
        text,
        title: document.title,
        url: window.location.href,
        targets: selectedTargets,
        shapes,
        selectSnapshot: screenshotSelection.select,
        capture:
          sharing.stream && shouldIncludeSnapshot
            ? async () => {
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
                    annotationRoot: annotationReference.current,
                    shouldKeepAnnotatedSurfaces: isAnnotatingDevhost,
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
              }
            : undefined,
      }),
    [
      isAnnotatingDevhost,
      rootReference,
      selectedTargets,
      stopSelection,
      shapes,
      sharing.stream,
      shouldIncludeSnapshot,
      screenshotSelection.select,
    ],
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
  const chat = useAgentChat({ pageURL: sessionPageURL, target, beforeSend, onSent: clearSentContext, settingsStore });
  const { isCatalogLoading, isConnecting, isPreparing, readDelivery, sendMessage, session, sessions } = chat;
  useEffect(() => {
    if (requestedMessage === undefined || isCatalogLoading || isConnecting || isPreparing) return;
    onRequestedMessageTaken?.(sendMessage(requestedMessage));
  }, [isCatalogLoading, isConnecting, isPreparing, onRequestedMessageTaken, requestedMessage, sendMessage]);
  useEffect(() => {
    if (!trackedRequest || isCatalogLoading || isConnecting) return;
    if (isChatRequestSettled(trackedRequest, sessions, session, readDelivery)) onTrackedRequestSettled?.();
  }, [isCatalogLoading, isConnecting, onTrackedRequestSettled, readDelivery, session, sessions, trackedRequest]);
  const isContextDisabled = isCapturing || chat.isPreparing;
  const composerInputReference = useChatComposerFocus({ isOpen, contextCount: selectedTargets.length + shapes.length });
  const hasPageMarks: boolean = isSelectionMode || tool !== null || selectedTargets.length > 0 || shapes.length > 0;
  const marks = (
    <>
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
    </>
  );
  return (
    <PortalProvider container={portalReference}>
      <DensityProvider density="compact">
        {isAnnotatingDevhost ? null : (
          <AnnotationTopLayer
            ref={marksReference}
            isVisible={hasPageMarks}
            placement="below-devtools"
            coverReference={annotationReference}
          >
            {marks}
          </AnnotationTopLayer>
        )}
        <AnnotationTopLayer
          ref={annotationReference}
          isVisible={isOpen || hasPageMarks || screenshotSelection.snapshot !== null}
        >
          <div ref={portalReference} className="pointer-events-auto relative z-(--devhost-z-modal)" />
          {screenshotSelection.snapshot ? (
            <Suspense fallback={null}>
              <ScreenshotShareDialog
                snapshot={screenshotSelection.snapshot}
                onShare={screenshotSelection.confirm}
                onCancel={screenshotSelection.cancel}
              />
            </Suspense>
          ) : null}
          <AnnotationSelectionHint
            isVisible={isSelectionMode || tool !== null}
            text={tool ? `Drag To Draw A ${tool}. Esc To Cancel.` : "Click Elements To Add Context. Esc To Finish."}
          />
          {isAnnotatingDevhost ? marks : null}
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
            onBusyChange={onBusyChange}
            sharing={{ ...sharing, shouldIncludeSnapshot, setShouldIncludeSnapshot }}
            chat={chat}
            composerInputRef={composerInputReference}
            toolbarPosition={toolbarPosition}
            toolbarEdgeInset={toolbarEdgeInset}
            headerControls={
              onTargetChange ? (
                <ChatTargetToggle target={target} isDisabled={chat.isPreparing} onTargetChange={onTargetChange} />
              ) : null
            }
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
        </AnnotationTopLayer>
      </DensityProvider>
    </PortalProvider>
  );
}
