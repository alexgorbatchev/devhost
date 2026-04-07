import { createContext } from "preact";

import type { IDevtoolsTheme } from "./devtoolsTheme";

export const devtoolsThemeContext = createContext<IDevtoolsTheme | null>(null);
