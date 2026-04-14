import { createContext } from "react";

import type { IDevtoolsTheme } from "./devtoolsTheme";

export const devtoolsThemeContext = createContext<IDevtoolsTheme | null>(null);
