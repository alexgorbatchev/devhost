import type { StorybookConfig } from "@storybook/preact-vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/preact-vite",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
};

export default config;
