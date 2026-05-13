import { createContext } from "react";

import type { DevtoolsColorScheme } from "./DevtoolsColorScheme";

export const devtoolsColorSchemeContext = createContext<DevtoolsColorScheme | null>(null);
