interface IAgentEndExtensionContext {
  shutdown: () => void;
}

interface IAgentEndExtensionApi {
  on: (
    eventName: "agent_end",
    handler: (_event: unknown, ctx: IAgentEndExtensionContext) => Promise<void> | void,
  ) => void;
}

export function registerAutoExitOnAgentEndExtension(pi: IAgentEndExtensionApi): void {
  pi.on("agent_end", async (_event: unknown, ctx: IAgentEndExtensionContext): Promise<void> => {
    ctx.shutdown();
  });
}

export default registerAutoExitOnAgentEndExtension;
