export type DevtoolsColorScheme = "light" | "dark";

export interface IDevtoolsTheme {
  colors: {
    accentBackground: string;
    accentForeground: string;
    backdrop: string;
    background: string;
    border: string;
    dangerBackground: string;
    dangerForeground: string;
    dangerGlow: string;
    foreground: string;
    logMinimapBackground: string;
    logMinimapOverlayBackground: string;
    logMinimapOverlayBorder: string;
    logMinimapStderr: string;
    logMinimapStdout: string;
    logPreviewStderrBackground: string;
    logPreviewStderrForeground: string;
    mutedForeground: string;
    selectionBackground: string;
    selectionBorder: string;
    successBackground: string;
    successGlow: string;
  };
  fontFamilies: {
    body: string;
    monospace: string;
  };
  terminal: {
    black: string;
    blue: string;
    brightBlack: string;
    brightBlue: string;
    brightCyan: string;
    brightGreen: string;
    brightMagenta: string;
    brightRed: string;
    brightWhite: string;
    brightYellow: string;
    cyan: string;
    green: string;
    magenta: string;
    red: string;
    white: string;
    yellow: string;
  };
  opacities: {
    logMinimapActive: number;
    logMinimapResting: number;
  };
  fontSizes: {
    lg: string;
    md: string;
    sm: string;
  };
  sizes: {
    logMinimapPeekWidth: string;
    logMinimapWidth: string;
    logPreviewRowHeight: string;
    logPreviewWidth: string;
    serviceStatusPanelPeekWidth: string;
  };
  spacing: {
    lg: string;
    md: string;
    sm: string;
    xl: string;
    xs: string;
    xxs: string;
  };
  zIndices: {
    floating: NonNullable<React.CSSProperties["zIndex"]>;
    terminalExpanded: NonNullable<React.CSSProperties["zIndex"]>;
    terminalTray: NonNullable<React.CSSProperties["zIndex"]>;
  };
}

interface IShadcnNeutralThemeColors {
  accent: string;
  accentForeground: string;
  background: string;
  border: string;
  card: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  destructive: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
}

const sharedFontFamily: string = [
  '"Maple Mono Normal NF"',
  '"JetBrainsMono Nerd Font"',
  "ui-monospace",
  "SFMono-Regular",
  "Menlo",
  "Monaco",
  "Consolas",
  '"Liberation Mono"',
  "monospace",
].join(", ");
const sharedFontFamilies: IDevtoolsTheme["fontFamilies"] = {
  body: sharedFontFamily,
  monospace: sharedFontFamily,
};
const sharedFontSizes: IDevtoolsTheme["fontSizes"] = {
  lg: "16px",
  md: "14px",
  sm: "12px",
};
const sharedOpacities: IDevtoolsTheme["opacities"] = {
  logMinimapActive: 1,
  logMinimapResting: 0.5,
};
const sharedSizes: IDevtoolsTheme["sizes"] = {
  logMinimapPeekWidth: "20px",
  logMinimapWidth: "100px",
  logPreviewRowHeight: "24px",
  logPreviewWidth: "80ch",
  serviceStatusPanelPeekWidth: "40px",
};
const sharedSpacing: IDevtoolsTheme["spacing"] = {
  lg: "16px",
  md: "12px",
  sm: "10px",
  xl: "64px",
  xs: "8px",
  xxs: "4px",
};
const sharedZIndices: IDevtoolsTheme["zIndices"] = {
  floating: 2_147_483_500,
  terminalExpanded: 2_147_483_600,
  terminalTray: 2_147_483_400,
};
const shadcnNeutralLightColors: IShadcnNeutralThemeColors = {
  accent: "oklch(0.97 0 0)",
  accentForeground: "oklch(0.205 0 0)",
  background: "oklch(1 0 0)",
  border: "oklch(0.922 0 0)",
  card: "oklch(1 0 0)",
  chart1: "oklch(0.646 0.222 41.116)",
  chart2: "oklch(0.6 0.118 184.704)",
  chart3: "oklch(0.398 0.07 227.392)",
  chart4: "oklch(0.828 0.189 84.429)",
  chart5: "oklch(0.769 0.188 70.08)",
  destructive: "oklch(0.577 0.245 27.325)",
  foreground: "oklch(0.145 0 0)",
  muted: "oklch(0.97 0 0)",
  mutedForeground: "oklch(0.556 0 0)",
  primary: "oklch(0.205 0 0)",
  primaryForeground: "oklch(0.985 0 0)",
  secondary: "oklch(0.97 0 0)",
  secondaryForeground: "oklch(0.205 0 0)",
};
const shadcnNeutralDarkColors: IShadcnNeutralThemeColors = {
  accent: "oklch(0.269 0 0)",
  accentForeground: "oklch(0.985 0 0)",
  background: "oklch(0.145 0 0)",
  border: "oklch(1 0 0 / 10%)",
  card: "oklch(0.205 0 0)",
  chart1: "oklch(0.488 0.243 264.376)",
  chart2: "oklch(0.696 0.17 162.48)",
  chart3: "oklch(0.769 0.188 70.08)",
  chart4: "oklch(0.627 0.265 303.9)",
  chart5: "oklch(0.645 0.246 16.439)",
  destructive: "oklch(0.704 0.191 22.216)",
  foreground: "oklch(0.985 0 0)",
  muted: "oklch(0.269 0 0)",
  mutedForeground: "oklch(0.708 0 0)",
  primary: "oklch(0.922 0 0)",
  primaryForeground: "oklch(0.205 0 0)",
  secondary: "oklch(0.269 0 0)",
  secondaryForeground: "oklch(0.985 0 0)",
};
const lightTerminalColors: IDevtoolsTheme["terminal"] = {
  black: shadcnNeutralLightColors.foreground,
  blue: shadcnNeutralLightColors.chart1,
  brightBlack: shadcnNeutralLightColors.mutedForeground,
  brightBlue: shadcnNeutralLightColors.chart3,
  brightCyan: shadcnNeutralLightColors.chart2,
  brightGreen: shadcnNeutralLightColors.chart2,
  brightMagenta: shadcnNeutralLightColors.chart4,
  brightRed: shadcnNeutralLightColors.destructive,
  brightWhite: shadcnNeutralLightColors.primaryForeground,
  brightYellow: shadcnNeutralLightColors.chart5,
  cyan: shadcnNeutralLightColors.chart2,
  green: shadcnNeutralLightColors.chart2,
  magenta: shadcnNeutralLightColors.chart4,
  red: shadcnNeutralLightColors.destructive,
  white: shadcnNeutralLightColors.mutedForeground,
  yellow: shadcnNeutralLightColors.chart5,
};
const darkTerminalColors: IDevtoolsTheme["terminal"] = {
  black: shadcnNeutralDarkColors.card,
  blue: shadcnNeutralDarkColors.chart1,
  brightBlack: shadcnNeutralDarkColors.mutedForeground,
  brightBlue: shadcnNeutralDarkColors.chart4,
  brightCyan: shadcnNeutralDarkColors.chart2,
  brightGreen: shadcnNeutralDarkColors.chart2,
  brightMagenta: shadcnNeutralDarkColors.chart4,
  brightRed: shadcnNeutralDarkColors.destructive,
  brightWhite: shadcnNeutralDarkColors.foreground,
  brightYellow: shadcnNeutralLightColors.chart5,
  cyan: shadcnNeutralDarkColors.chart2,
  green: shadcnNeutralDarkColors.chart2,
  magenta: shadcnNeutralDarkColors.chart4,
  red: shadcnNeutralDarkColors.destructive,
  white: shadcnNeutralDarkColors.mutedForeground,
  yellow: shadcnNeutralLightColors.chart5,
};
const lightDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: shadcnNeutralLightColors.primary,
    accentForeground: shadcnNeutralLightColors.primaryForeground,
    backdrop: "oklch(1 0 0 / 78%)",
    background: shadcnNeutralLightColors.background,
    border: shadcnNeutralLightColors.border,
    dangerBackground: shadcnNeutralLightColors.destructive,
    dangerForeground: shadcnNeutralLightColors.destructive,
    dangerGlow: "oklch(0.577 0.245 27.325 / 35%)",
    foreground: shadcnNeutralLightColors.foreground,
    logMinimapBackground: shadcnNeutralLightColors.secondary,
    logMinimapOverlayBackground: "oklch(0.556 0 0 / 12%)",
    logMinimapOverlayBorder: "oklch(0.6 0.118 184.704 / 30%)",
    logMinimapStderr: "oklch(0.577 0.245 27.325 / 88%)",
    logMinimapStdout: "oklch(0.145 0 0 / 16%)",
    logPreviewStderrBackground: "oklch(0.577 0.245 27.325 / 12%)",
    logPreviewStderrForeground: shadcnNeutralLightColors.destructive,
    mutedForeground: shadcnNeutralLightColors.mutedForeground,
    selectionBackground: shadcnNeutralLightColors.accent,
    selectionBorder: shadcnNeutralLightColors.primary,
    successBackground: shadcnNeutralLightColors.chart2,
    successGlow: "oklch(0.6 0.118 184.704 / 35%)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  terminal: lightTerminalColors,
  sizes: sharedSizes,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};
const darkDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: shadcnNeutralDarkColors.primary,
    accentForeground: shadcnNeutralDarkColors.primaryForeground,
    backdrop: "oklch(0.145 0 0 / 78%)",
    background: shadcnNeutralDarkColors.background,
    border: shadcnNeutralDarkColors.border,
    dangerBackground: shadcnNeutralDarkColors.destructive,
    dangerForeground: shadcnNeutralDarkColors.destructive,
    dangerGlow: "oklch(0.704 0.191 22.216 / 32%)",
    foreground: shadcnNeutralDarkColors.foreground,
    logMinimapBackground: shadcnNeutralDarkColors.secondary,
    logMinimapOverlayBackground: "oklch(0.556 0 0 / 24%)",
    logMinimapOverlayBorder: "oklch(0.696 0.17 162.48 / 28%)",
    logMinimapStderr: "oklch(0.704 0.191 22.216 / 90%)",
    logMinimapStdout: "oklch(0.985 0 0 / 14%)",
    logPreviewStderrBackground: "oklch(0.704 0.191 22.216 / 18%)",
    logPreviewStderrForeground: shadcnNeutralDarkColors.foreground,
    mutedForeground: shadcnNeutralDarkColors.mutedForeground,
    selectionBackground: shadcnNeutralDarkColors.accent,
    selectionBorder: shadcnNeutralDarkColors.primary,
    successBackground: shadcnNeutralDarkColors.chart2,
    successGlow: "oklch(0.696 0.17 162.48 / 34%)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  terminal: darkTerminalColors,
  sizes: sharedSizes,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};

export function getDevtoolsTheme(colorScheme: DevtoolsColorScheme): IDevtoolsTheme {
  return colorScheme === "dark" ? darkDevtoolsTheme : lightDevtoolsTheme;
}
