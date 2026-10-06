import type { JSX } from "react";
import { useState } from "react";

import { Button } from "../../../../../components/ui/Button";
import { StorybookThemeProvider } from "../../../../shared/components/stories/helpers";
import type { DevtoolsColorScheme } from "../../../../shared/DevtoolsColorScheme";
import { LogMinimap } from "../LogMinimap";
import { fixture_ansiContrastEntries } from "./fixtures";

export function LogMinimapThemeChangeHarness(): JSX.Element {
  const [colorScheme, setColorScheme] = useState<DevtoolsColorScheme>("dark");
  return (
    <StorybookThemeProvider globals={{ devhostTheme: colorScheme }}>
      <Button onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}>
        Switch to {colorScheme === "dark" ? "light" : "dark"}
      </Button>
      <LogMinimap entries={fixture_ansiContrastEntries} isHovered onHoveredChange={() => {}} />
    </StorybookThemeProvider>
  );
}
