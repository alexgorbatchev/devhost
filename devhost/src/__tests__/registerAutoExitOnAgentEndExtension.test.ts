import { describe, expect, test } from "bun:test";

import { registerAutoExitOnAgentEndExtension } from "../registerAutoExitOnAgentEndExtension";

describe("registerAutoExitOnAgentEndExtension", () => {
  test("requests shutdown when the agent finishes", async () => {
    let agentEndHandler: (event: unknown, ctx: { shutdown: () => void }) => Promise<void> | void = (): void => {
      throw new Error("Expected the extension to register an agent_end handler.");
    };
    let shutdownCallCount: number = 0;
    const extensionApi = {
      on: (
        eventName: "agent_end",
        handler: (event: unknown, ctx: { shutdown: () => void }) => Promise<void> | void,
      ): void => {
        agentEndHandler = handler;
        expect(eventName).toBe("agent_end");
      },
    };

    registerAutoExitOnAgentEndExtension(extensionApi);

    await agentEndHandler({}, {
      shutdown: (): void => {
        shutdownCallCount += 1;
      },
    });

    expect(shutdownCallCount).toBe(1);
  });
});
