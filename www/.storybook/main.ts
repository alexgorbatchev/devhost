import type { StorybookConfig } from "@storybook/react-vite";
import type { UserConfig } from "vite";

const optimizedDependencyIds: string[] = ["@rrweb/all"];

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  staticDirs: ["../public"],
  stories: ["../stories/**/*.stories.@(ts|tsx)"],
  async viteFinal(viteConfig: UserConfig): Promise<UserConfig> {
    const existingIncludedDependencyIds: string[] = viteConfig.optimizeDeps?.include ?? [];

    return {
      ...viteConfig,
      optimizeDeps: {
        ...viteConfig.optimizeDeps,
        include: [...new Set([...existingIncludedDependencyIds, ...optimizedDependencyIds])],
      },
    };
  },
};

export default config;
