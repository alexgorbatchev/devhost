import type { DevtoolsColorScheme } from "./devtoolsTheme";

export function resolveDocumentColorScheme(
  computedColorScheme: string,
  prefersDarkColorScheme: boolean,
): DevtoolsColorScheme {
  const colorSchemeTokens: string[] = computedColorScheme.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hasDarkColorScheme: boolean = colorSchemeTokens.includes("dark");
  const hasLightColorScheme: boolean = colorSchemeTokens.includes("light");

  if (hasDarkColorScheme && !hasLightColorScheme) {
    return "dark";
  }

  if (hasLightColorScheme && !hasDarkColorScheme) {
    return "light";
  }

  return prefersDarkColorScheme ? "dark" : "light";
}
