import { describe, expect, spyOn, test } from "bun:test";

import { registerAgentStatusExtension } from "../registerAgentStatusExtension";
import type { IAgentStatusExtensionApi } from "../registerAgentStatusExtension";

type EmptyCallback = () => void;

describe("registerAgentStatusExtension", () => {
  test("writes working status on agent_start and finished status on agent_end", () => {
    let agentStartHandler: EmptyCallback | undefined;
    let agentEndHandler: EmptyCallback | undefined;

    const extensionApi: IAgentStatusExtensionApi = {
      on: (eventName: string, handler: EmptyCallback): void => {
        const handlers: Record<string, EmptyCallback> = {
          agent_end: () => {
            agentEndHandler = handler;
          },
          agent_start: () => {
            agentStartHandler = handler;
          },
        };

        const executeHandler = handlers[eventName];
        executeHandler?.();
      },
    };

    registerAgentStatusExtension(extensionApi);

    expect(agentStartHandler).toBeDefined();
    expect(agentEndHandler).toBeDefined();

    // Mock process.stdout.write to capture the OSC sequences
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      // Trigger the handlers
      agentStartHandler?.();
      expect(writeSpy).toHaveBeenCalledWith("\x1b]1337;SetAgentStatus=working\x07");

      writeSpy.mockClear();

      agentEndHandler?.();
      expect(writeSpy).toHaveBeenCalledWith("\x1b]1337;SetAgentStatus=finished\x07");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
