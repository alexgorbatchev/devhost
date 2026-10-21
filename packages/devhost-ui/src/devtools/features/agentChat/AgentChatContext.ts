import { createContext } from "react";
import type { IAgentChatController } from "./types";

export const AgentChatContext = createContext<IAgentChatController | null>(null);
