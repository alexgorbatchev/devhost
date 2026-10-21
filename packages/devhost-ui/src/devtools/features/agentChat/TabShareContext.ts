import { createContext } from "react";
import type { useTabShare } from "../visualAnnotations/hooks/useTabShare";

export const TabShareContext = createContext<ReturnType<typeof useTabShare> | undefined>(undefined);
