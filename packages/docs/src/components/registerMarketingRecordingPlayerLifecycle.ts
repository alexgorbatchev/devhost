import { EventType, IncrementalSource, type eventWithTime } from "@rrweb/types";

const REPLAY_CURSOR_ATTRIBUTE_NAME = "data-replay-cursor";
const DOM_ELEMENT_NODE = 1;

type ReplayCursorVariant = "default" | "pointer";

interface IComputedStyle {
  cursor: string;
}

interface IReplayCursorOwnerDocument {
  defaultView: {
    getComputedStyle(element: IReplayCursorElement): IComputedStyle;
  } | null;
}

interface IReplayCursorTargetNode {
  nodeType: number;
  parentElement: IReplayCursorElement | null;
}

interface IReplayCursorElement extends IReplayCursorTargetNode {
  ownerDocument: IReplayCursorOwnerDocument;
}

interface IReplayMirror {
  getNode(id: number): IReplayCursorTargetNode | null;
}

interface IReplayMouseElement {
  setAttribute(name: string, value: string): void;
}

interface IReplayerWrapper {
  querySelector(selector: string): IReplayMouseElement | null;
}

interface IReplayer {
  getMirror(): IReplayMirror;
  wrapper: IReplayerWrapper;
}

interface IRecordingPlayerLifecycle {
  addEventListener(event: string, handler: (detail: unknown) => void): void;
  getReplayer(): IReplayer;
  play(): void;
}

interface IRegisterMarketingRecordingPlayerLifecycleOptions {
  player: IRecordingPlayerLifecycle;
  scheduleResponsivePlayerLayout: () => void;
}

export function registerMarketingRecordingPlayerLifecycle(
  options: IRegisterMarketingRecordingPlayerLifecycleOptions,
): void {
  const replayer = options.player.getReplayer();
  const replayMouseElement = readReplayMouseElement(replayer.wrapper);

  updateReplayCursorVariant(replayMouseElement, "default");

  options.player.addEventListener("finish", (): void => {
    options.player.play();
    options.scheduleResponsivePlayerLayout();
  });

  options.player.addEventListener("event-cast", (detail: unknown): void => {
    const replayCursorTargetNodeId = readReplayCursorTargetNodeId(detail);

    if (replayCursorTargetNodeId === null) {
      return;
    }

    const replayCursorVariant = readReplayCursorVariant(replayer, replayCursorTargetNodeId);
    updateReplayCursorVariant(replayMouseElement, replayCursorVariant);
  });

  options.player.addEventListener("resize", (): void => {
    options.scheduleResponsivePlayerLayout();
  });
}

function isElementNode(node: IReplayCursorTargetNode): node is IReplayCursorElement {
  return node.nodeType === DOM_ELEMENT_NODE;
}

function isRrwebReplayEvent(value: unknown): value is eventWithTime {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const eventType = Reflect.get(value, "type");
  const timestamp = Reflect.get(value, "timestamp");

  return typeof eventType === "number" && typeof timestamp === "number" && Reflect.has(value, "data");
}

function readCursorTargetElement(node: IReplayCursorTargetNode | null): IReplayCursorElement | null {
  if (node === null) {
    return null;
  }

  if (isElementNode(node)) {
    return node;
  }

  return node.parentElement;
}

function readReplayCursorTargetNodeId(detail: unknown): number | null {
  if (!isRrwebReplayEvent(detail) || detail.type !== EventType.IncrementalSnapshot) {
    return null;
  }

  switch (detail.data.source) {
    case IncrementalSource.Drag:
    case IncrementalSource.MouseMove:
    case IncrementalSource.TouchMove: {
      const lastPosition = detail.data.positions.at(-1);
      return lastPosition?.id ?? null;
    }
    case IncrementalSource.MouseInteraction:
      return detail.data.id;
    default:
      return null;
  }
}

function readReplayCursorVariant(replayer: IReplayer, replayCursorTargetNodeId: number): ReplayCursorVariant {
  if (replayCursorTargetNodeId < 0) {
    return "default";
  }

  const replayCursorTargetNode = replayer.getMirror().getNode(replayCursorTargetNodeId);
  const replayCursorTargetElement = readCursorTargetElement(replayCursorTargetNode);

  if (replayCursorTargetElement === null) {
    return "default";
  }

  const computedCursorStyle =
    replayCursorTargetElement.ownerDocument.defaultView?.getComputedStyle(replayCursorTargetElement).cursor;

  if (computedCursorStyle?.includes("pointer")) {
    return "pointer";
  }

  return "default";
}

function readReplayMouseElement(replayerWrapperElement: IReplayerWrapper): IReplayMouseElement | null {
  return replayerWrapperElement.querySelector(".replayer-mouse");
}

function updateReplayCursorVariant(
  replayMouseElement: IReplayMouseElement | null,
  replayCursorVariant: ReplayCursorVariant,
): void {
  replayMouseElement?.setAttribute(REPLAY_CURSOR_ATTRIBUTE_NAME, replayCursorVariant);
}
