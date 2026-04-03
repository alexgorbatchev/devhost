import assert from "node:assert";

import { describe, expect, test } from "bun:test";

import { registerAutoExitOnAgentEndExtension } from "../registerAutoExitOnAgentEndExtension";
import type { AgentEndContext, AgentEndHandler } from "./testTypes";

describe("registerAutoExitOnAgentEndExtension", () => {
  test("requests shutdown when the agent finishes", async () => {
    let agentEndHandler: AgentEndHandler = (): void => {
      assert.fail("Expected the extension to register an agent_end handler.");
    };
    let shutdownCallCount: number = 0;
    const extensionApi = {
      on: (eventName: "agent_end", handler: AgentEndHandler): void => {
        agentEndHandler = handler;
        expect(eventName).toBe("agent_end");
      },
    };

    registerAutoExitOnAgentEndExtension(extensionApi);

    await agentEndHandler({}, {
      shutdown: (): void => {
        shutdownCallCount += 1;
      },
    } as AgentEndContext);

    expect(shutdownCallCount).toBe(1);
  });
});
