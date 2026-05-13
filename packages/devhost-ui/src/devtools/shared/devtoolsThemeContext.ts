import { createContext } from "react";

import type { DevtoolsColorScheme } from "./devtoolsTheme";

export const devtoolsThemeContext = createContext<DevtoolsColorScheme | null>(null);
