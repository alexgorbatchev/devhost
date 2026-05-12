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
    highlightBackground: string;
    highlightForeground: string;
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

interface ICatppuccinThemeColors {
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
const sharedHighlightForeground: string = "hsl(0 0% 100%)";
const catppuccinLatteColors: ICatppuccinThemeColors = {
  accent: "hsl(223 15.909% 82.745%)",
  accentForeground: "hsl(234 16.022% 35.49%)",
  background: "hsl(220 23.077% 94.902%)",
  border: "hsl(225 13.559% 76.863%)",
  card: "hsl(220 23.077% 94.902%)",
  chart1: "hsl(347 86.667% 44.118%)",
  chart2: "hsl(183 73.864% 34.51%)",
  chart3: "hsl(220 91.489% 53.922%)",
  chart4: "hsl(35 76.984% 49.412%)",
  chart5: "hsl(109 57.635% 39.804%)",
  destructive: "hsl(347 86.667% 44.118%)",
  foreground: "hsl(234 16.022% 35.49%)",
  muted: "hsl(223 15.909% 82.745%)",
  mutedForeground: "hsl(233 12.796% 41.373%)",
  primary: "hsl(266 85.047% 58.039%)",
  primaryForeground: "hsl(220 23.077% 94.902%)",
  secondary: "hsl(223 15.909% 82.745%)",
  secondaryForeground: "hsl(234 16.022% 35.49%)",
};
const catppuccinFrappeColors: ICatppuccinThemeColors = {
  accent: "hsl(230 15.584% 30.196%)",
  accentForeground: "hsl(227 70.149% 86.863%)",
  background: "hsl(229 18.644% 23.137%)",
  border: "hsl(227 14.737% 37.255%)",
  card: "hsl(229 18.644% 23.137%)",
  chart1: "hsl(359 67.785% 70.784%)",
  chart2: "hsl(172 39.227% 64.51%)",
  chart3: "hsl(222 74.242% 74.118%)",
  chart4: "hsl(40 62.044% 73.137%)",
  chart5: "hsl(96 43.902% 67.843%)",
  destructive: "hsl(359 67.785% 70.784%)",
  foreground: "hsl(227 70.149% 86.863%)",
  muted: "hsl(230 15.584% 30.196%)",
  mutedForeground: "hsl(227 43.689% 79.804%)",
  primary: "hsl(277 59.016% 76.078%)",
  primaryForeground: "hsl(229 18.644% 23.137%)",
  secondary: "hsl(230 15.584% 30.196%)",
  secondaryForeground: "hsl(227 70.149% 86.863%)",
};
const lightTerminalColors: IDevtoolsTheme["terminal"] = {
  black: catppuccinLatteColors.foreground,
  blue: catppuccinLatteColors.chart3,
  brightBlack: catppuccinLatteColors.mutedForeground,
  brightBlue: catppuccinLatteColors.chart3,
  brightCyan: catppuccinLatteColors.chart2,
  brightGreen: catppuccinLatteColors.chart5,
  brightMagenta: catppuccinLatteColors.primary,
  brightRed: catppuccinLatteColors.destructive,
  brightWhite: catppuccinLatteColors.primaryForeground,
  brightYellow: catppuccinLatteColors.chart4,
  cyan: catppuccinLatteColors.chart2,
  green: catppuccinLatteColors.chart5,
  magenta: catppuccinLatteColors.primary,
  red: catppuccinLatteColors.destructive,
  white: catppuccinLatteColors.mutedForeground,
  yellow: catppuccinLatteColors.chart4,
};
const darkTerminalColors: IDevtoolsTheme["terminal"] = {
  black: catppuccinFrappeColors.card,
  blue: catppuccinFrappeColors.chart3,
  brightBlack: catppuccinFrappeColors.mutedForeground,
  brightBlue: catppuccinFrappeColors.chart3,
  brightCyan: catppuccinFrappeColors.chart2,
  brightGreen: catppuccinFrappeColors.chart5,
  brightMagenta: catppuccinFrappeColors.primary,
  brightRed: catppuccinFrappeColors.destructive,
  brightWhite: catppuccinFrappeColors.foreground,
  brightYellow: catppuccinFrappeColors.chart4,
  cyan: catppuccinFrappeColors.chart2,
  green: catppuccinFrappeColors.chart5,
  magenta: catppuccinFrappeColors.primary,
  red: catppuccinFrappeColors.destructive,
  white: catppuccinFrappeColors.mutedForeground,
  yellow: catppuccinFrappeColors.chart4,
};
const lightDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: catppuccinLatteColors.primary,
    accentForeground: catppuccinLatteColors.primaryForeground,
    backdrop: "hsl(220 23.077% 94.902% / 78%)",
    background: catppuccinLatteColors.background,
    border: catppuccinLatteColors.border,
    dangerBackground: catppuccinLatteColors.destructive,
    dangerForeground: catppuccinLatteColors.destructive,
    dangerGlow: "hsl(347 86.667% 44.118% / 35%)",
    foreground: catppuccinLatteColors.foreground,
    highlightBackground: catppuccinLatteColors.chart3,
    highlightForeground: sharedHighlightForeground,
    logMinimapBackground: catppuccinLatteColors.secondary,
    logMinimapOverlayBackground: "hsl(233 12.796% 41.373% / 12%)",
    logMinimapOverlayBorder: "hsl(183 73.864% 34.51% / 30%)",
    logMinimapStderr: "hsl(347 86.667% 44.118% / 88%)",
    logMinimapStdout: "hsl(234 16.022% 35.49% / 16%)",
    logPreviewStderrBackground: "hsl(347 86.667% 44.118% / 12%)",
    logPreviewStderrForeground: catppuccinLatteColors.destructive,
    mutedForeground: catppuccinLatteColors.mutedForeground,
    selectionBackground: catppuccinLatteColors.accent,
    selectionBorder: catppuccinLatteColors.primary,
    successBackground: catppuccinLatteColors.chart2,
    successGlow: "hsl(183 73.864% 34.51% / 35%)",
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
    accentBackground: catppuccinFrappeColors.primary,
    accentForeground: catppuccinFrappeColors.primaryForeground,
    backdrop: "hsl(229 18.644% 23.137% / 78%)",
    background: catppuccinFrappeColors.background,
    border: catppuccinFrappeColors.border,
    dangerBackground: catppuccinFrappeColors.destructive,
    dangerForeground: catppuccinFrappeColors.destructive,
    dangerGlow: "hsl(359 67.785% 70.784% / 32%)",
    foreground: catppuccinFrappeColors.foreground,
    highlightBackground: catppuccinFrappeColors.chart3,
    highlightForeground: sharedHighlightForeground,
    logMinimapBackground: catppuccinFrappeColors.secondary,
    logMinimapOverlayBackground: "hsl(227 14.737% 37.255% / 24%)",
    logMinimapOverlayBorder: "hsl(172 39.227% 64.51% / 28%)",
    logMinimapStderr: "hsl(359 67.785% 70.784% / 90%)",
    logMinimapStdout: "hsl(227 70.149% 86.863% / 14%)",
    logPreviewStderrBackground: "hsl(359 67.785% 70.784% / 18%)",
    logPreviewStderrForeground: catppuccinFrappeColors.foreground,
    mutedForeground: catppuccinFrappeColors.mutedForeground,
    selectionBackground: catppuccinFrappeColors.accent,
    selectionBorder: catppuccinFrappeColors.primary,
    successBackground: catppuccinFrappeColors.chart2,
    successGlow: "hsl(172 39.227% 64.51% / 34%)",
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
