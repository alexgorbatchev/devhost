import assert from "node:assert";
import { describe, expect, it } from "bun:test";

import { registerMarketingRecordingPlayerLifecycle } from "../registerMarketingRecordingPlayerLifecycle";

type RecordingPlayerListener = () => void;

interface IRecordingPlayerListenerRegistry {
  [event: string]: RecordingPlayerListener;
}

describe("registerMarketingRecordingPlayerLifecycle", () => {
  it("restarts the replay and reapplies the responsive layout after playback finishes", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    let playCallCount = 0;
    let scheduleResponsivePlayerLayoutCallCount = 0;

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
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
    finishListener();

    expect(playCallCount).toBe(1);
    expect(scheduleResponsivePlayerLayoutCallCount).toBe(1);
  });

  it("reapplies the responsive layout when rrweb-player emits a resize event", () => {
    const listeners: IRecordingPlayerListenerRegistry = {};
    let scheduleResponsivePlayerLayoutCallCount = 0;

    registerMarketingRecordingPlayerLifecycle({
      player: {
        addEventListener(event: string, handler: RecordingPlayerListener): void {
          listeners[event] = handler;
        },
        play(): void {},
      },
      scheduleResponsivePlayerLayout(): void {
        scheduleResponsivePlayerLayoutCallCount += 1;
      },
    });

    const resizeListener = listeners.resize;
    assert(resizeListener);
    resizeListener();

    expect(scheduleResponsivePlayerLayoutCallCount).toBe(1);
  });
});
