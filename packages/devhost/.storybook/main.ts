import type { StorybookConfig } from "@storybook/preact-vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/preact-vite",
    options: {
      builder: {
        viteConfigPath: "vite.config.ts",
      },
    },
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-vitest"],
};

export default config;
