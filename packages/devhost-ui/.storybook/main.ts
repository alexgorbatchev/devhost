import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig } from "vite";

function readStorybookAllowedHosts(): string[] {
  const allowedHostsText = process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS;
  if (!allowedHostsText) {
    return [];
  }

  return [
    ...new Set(
      allowedHostsText
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value !== ""),
    ),
  ];
}

const storybookAllowedHosts: string[] = readStorybookAllowedHosts();

const config: StorybookConfig = {
  core: {
    allowedHosts: storybookAllowedHosts,
  },
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        viteConfigPath: "vite.config.ts",
      },
    },
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-vitest"],
  viteFinal(existingConfig) {
    if (storybookAllowedHosts.length === 0) {
      return existingConfig;
    }

    return mergeConfig(existingConfig, {
      server: {
        allowedHosts: storybookAllowedHosts,
      },
    });
  },
};

export default config;
