import { createContext } from "react";
import type { useTabShare } from "../visualAnnotations/hooks/useTabShare";

export interface IChatTabShare extends ReturnType<typeof useTabShare> {
  shouldIncludeSnapshot: boolean;
  setShouldIncludeSnapshot: (shouldInclude: boolean) => void;
}

export const TabShareContext = createContext<IChatTabShare | undefined>(undefined);
