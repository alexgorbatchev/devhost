import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "@storybook/react-vite";
import type { UserConfig } from "vite";

const optimizedDependencyIds: string[] = ["@rrweb/all", "react/jsx-dev-runtime", "react/jsx-runtime"];

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-vitest"],
  async viteFinal(viteConfig: UserConfig): Promise<UserConfig> {
    const existingIncludedDependencyIds: string[] = viteConfig.optimizeDeps?.include ?? [];

    return {
      ...viteConfig,
      plugins: [...(viteConfig.plugins ?? []), tailwindcss()],
      optimizeDeps: {
        ...viteConfig.optimizeDeps,
        include: [...new Set([...existingIncludedDependencyIds, ...optimizedDependencyIds])],
      },
    };
  },
};

export default config;
