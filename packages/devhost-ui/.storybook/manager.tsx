import React from "react";
import { addons, types, useGlobals } from "storybook/manager-api";

import type { DevtoolsColorScheme } from "../src/devtools/shared";
import { DevhostThemeSwitchTool } from "../src/devtools/shared/components/DevhostThemeSwitchTool";
import {
  readStorybookDevtoolsColorScheme,
  storybookDevtoolsThemeGlobalName,
} from "../src/devtools/shared/storybookTheme";

const addonId: string = "devhost/theme-switch";
const toolId: string = `${addonId}/tool`;

function renderDevhostThemeSwitchTool() {
  const [globals, updateGlobals] = useGlobals();
  const colorScheme: DevtoolsColorScheme = readStorybookDevtoolsColorScheme(globals);

  function selectColorScheme(nextColorScheme: DevtoolsColorScheme): void {
    updateGlobals({ [storybookDevtoolsThemeGlobalName]: nextColorScheme });
  }

  // Storybook manager config is a non-component integration file, so keep the actual UI in the owned component module.
  return <DevhostThemeSwitchTool colorScheme={colorScheme} onSelectColorScheme={selectColorScheme} />;
}

addons.register(addonId, (): void => {
  addons.add(toolId, {
    render: renderDevhostThemeSwitchTool,
    title: "Devhost theme",
    type: types.TOOL,
  });
});
