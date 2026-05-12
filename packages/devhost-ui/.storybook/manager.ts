import { addons, types } from "storybook/manager-api";

import { DevhostThemeSwitchTool } from "../src/devtools/shared/stories/DevhostThemeSwitchTool";

const addonId: string = "devhost/theme-switch";
const toolId: string = `${addonId}/tool`;

addons.register(addonId, (): void => {
  addons.add(toolId, {
    render: DevhostThemeSwitchTool,
    title: "Devhost theme",
    type: types.TOOL,
  });
});
