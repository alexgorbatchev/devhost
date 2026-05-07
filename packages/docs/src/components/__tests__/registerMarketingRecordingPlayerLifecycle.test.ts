import assert from "node:assert";
import { describe, expect, it } from "bun:test";
import { EventType, IncrementalSource } from "@rrweb/types";

import { registerMarketingRecordingPlayerLifecycle } from "../registerMarketingRecordingPlayerLifecycle";

type RecordingPlayerListener = (detail: unknown) => void;

const DOM_ELEMENT_NODE = 1;

Reflect.set(globalThis, "Node", { ELEMENT_NODE: DOM_ELEMENT_NODE });

interface IRecordingPlayerListenerRegistry {
  [event: string]: RecordingPlayerListener;
}

interface IReplayMouseElement {
  className: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

interface IReplayerWrapperElement {
  querySelector(selector: string): IReplayMouseElement | null;
}

interface IComputedStyle {
  cursor: string;
}

interface IDefaultView {
  getComputedStyle(): IComputedStyle;
}

interface IOwnerDocument {
  defaultView: IDefaultView;
}

interface IElementLikeNode {
  nodeType: number;
  ownerDocument: IOwnerDocument;
  parentElement: null;
}

function createReplayMouseFixture(): {
  replayMouseElement: IReplayMouseElement;
  replayerWrapperElement: IReplayerWrapperElement;
} {
  const attributes = new Map<string, string>();
  const replayMouseElement: IReplayMouseElement = {
    className: "replayer-mouse",
    getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string): void {
      attributes.set(name, value);
    },
  };
  const replayerWrapperElement: IReplayerWrapperElement = {
    querySelector(selector: string): IReplayMouseElement | null {
      return selector === ".replayer-mouse" ? replayMouseElement : null;
    },
  };

  return { replayMouseElement, replayerWrapperElement };
}

function createMirrorNodeReader(nodesById: Record<number, IElementLikeNode>): (id: number) => IElementLikeNode | null {
  return (id: number): IElementLikeNode | null => {
    return nodesById[id] ?? null;
  };
}

function createElementLikeNode(cursor: string): IElementLikeNode {
  return {
    nodeType: DOM_ELEMENT_NODE,
    ownerDocument: {
      defaultView: {
        getComputedStyle(): IComputedStyle {
          return { cursor };
        },
      },
    },
    parentElement: null,
  };
}

describe("registerMarketingRecordingPlayerLifecycle", () => {
  it("restarts the replay and reapplies the responsive layout after playback finishes", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    let playCallCount = 0;
    let scheduleResponsivePlayerLayoutCallCount = 0;
    const { replayerWrapperElement } = createReplayMouseFixture();

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
        },
        getReplayer() {
          return {
            getMirror() {
              return {
                getNode(): Node | null {
                  return null;
                },
              };
            },
            wrapper: replayerWrapperElement,
          };
        },
        play(): void {
          playCallCount += 1;
        },
      },
      scheduleResponsivePlayerLayout(): void {
        scheduleResponsivePlayerLayoutCallCount += 1;
      },
    });

    const finishListener = listeners.finish;
    assert(finishListener);
    finishListener(undefined);

    expect(playCallCount).toBe(1);
    expect(scheduleResponsivePlayerLayoutCallCount).toBe(1);
  });

  it("reapplies the responsive layout when rrweb-player emits a resize event", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    let scheduleResponsivePlayerLayoutCallCount = 0;
    const { replayerWrapperElement } = createReplayMouseFixture();

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
        },
        getReplayer() {
          return {
            getMirror() {
              return {
                getNode(): Node | null {
                  return null;
                },
              };
            },
            wrapper: replayerWrapperElement,
          };
        },
        play(): void {},
      },
      scheduleResponsivePlayerLayout(): void {
        scheduleResponsivePlayerLayoutCallCount += 1;
      },
    });

    const resizeListener = listeners.resize;
    assert(resizeListener);
    resizeListener(undefined);

    expect(scheduleResponsivePlayerLayoutCallCount).toBe(1);
  });

  it("switches the replay overlay to the pointer cursor for pointer targets", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    const pointerTargetElement = createElementLikeNode("pointer");
    const { replayMouseElement, replayerWrapperElement } = createReplayMouseFixture();
    const readMirrorNode = createMirrorNodeReader({ 42: pointerTargetElement });

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
        },
        getReplayer() {
          return {
            getMirror() {
              return {
                getNode: readMirrorNode,
              };
            },
            wrapper: replayerWrapperElement,
          };
        },
        play(): void {},
      },
      scheduleResponsivePlayerLayout(): void {},
    });

    const eventCastListener = listeners["event-cast"];
    assert(eventCastListener);
    eventCastListener({
      data: {
        positions: [{ id: 42, timeOffset: 0, x: 10, y: 20 }],
        source: IncrementalSource.MouseMove,
      },
      timestamp: 1,
      type: EventType.IncrementalSnapshot,
    });

    expect(replayMouseElement.getAttribute("data-replay-cursor")).toBe("pointer");
  });

  it("switches the replay overlay back to the default cursor for non-pointer targets", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    const defaultTargetElement = createElementLikeNode("grab");
    const { replayMouseElement, replayerWrapperElement } = createReplayMouseFixture();
    const readMirrorNode = createMirrorNodeReader({ 7: defaultTargetElement });

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
        },
        getReplayer() {
          return {
            getMirror() {
              return {
                getNode: readMirrorNode,
              };
            },
            wrapper: replayerWrapperElement,
          };
        },
        play(): void {},
      },
      scheduleResponsivePlayerLayout(): void {},
    });

    const eventCastListener = listeners["event-cast"];
    assert(eventCastListener);
    eventCastListener({
      data: {
        id: 7,
        source: IncrementalSource.MouseInteraction,
        type: 2,
        x: 10,
        y: 20,
      },
      timestamp: 1,
      type: EventType.IncrementalSnapshot,
    });

    expect(replayMouseElement.getAttribute("data-replay-cursor")).toBe("default");
  });
});
