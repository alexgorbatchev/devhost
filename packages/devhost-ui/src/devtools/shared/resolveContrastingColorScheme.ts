import type { DevtoolsColorScheme } from "./devtoolsTheme";

export function resolveContrastingColorScheme(hostColorScheme: DevtoolsColorScheme): DevtoolsColorScheme {
  return hostColorScheme === "dark" ? "light" : "dark";
}
