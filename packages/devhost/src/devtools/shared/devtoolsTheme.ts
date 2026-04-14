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
  radii: {
    lg: string;
    md: string;
    pill: string;
    sm: string;
  };
  sizes: {
    logMinimapPeekWidth: string;
    logMinimapWidth: string;
    logPreviewRowHeight: string;
    logPreviewWidth: string;
    serviceStatusPanelPeekWidth: string;
  };
  shadows: {
    floating: string;
    popup: string;
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
const sharedRadii: IDevtoolsTheme["radii"] = {
  lg: "12px",
  md: "8px",
  pill: "999px",
  sm: "4px",
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
const sharedShadows: IDevtoolsTheme["shadows"] = {
  floating: "0px 10px 24px rgba(15, 23, 42, 0.14)",
  popup: "4px 5px 10px rgba(0, 0, 0, 0.8), -4px 5px 10px rgba(0, 0, 0, 0.4)",
};
const lightTerminalColors: IDevtoolsTheme["terminal"] = {
  black: "#b4b5b9",
  blue: "#2e7de9",
  brightBlack: "#a1a6c5",
  brightBlue: "#358aff",
  brightCyan: "#007ea8",
  brightGreen: "#5c8524",
  brightMagenta: "#a463ff",
  brightRed: "#ff4774",
  brightWhite: "#3760bf",
  brightYellow: "#a27629",
  cyan: "#007197",
  green: "#587539",
  magenta: "#9854f1",
  red: "#f52a65",
  white: "#6172b0",
  yellow: "#8c6c3e",
};
const darkTerminalColors: IDevtoolsTheme["terminal"] = {
  black: "#1d202f",
  blue: "#7aa2f7",
  brightBlack: "#414868",
  brightBlue: "#8db0ff",
  brightCyan: "#a4daff",
  brightGreen: "#9fe044",
  brightMagenta: "#c7a9ff",
  brightRed: "#ff899d",
  brightWhite: "#c0caf5",
  brightYellow: "#faba4a",
  cyan: "#7dcfff",
  green: "#9ece6a",
  magenta: "#bb9af7",
  red: "#f7768e",
  white: "#a9b1d6",
  yellow: "#e0af68",
};
const lightDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#2e7de9",
    accentForeground: "#11121a",
    backdrop: "rgba(225, 226, 231, 0.76)",
    background: "#e1e2e7",
    border: "#b4b5b9",
    dangerBackground: "#f7768e",
    dangerForeground: "#c64343",
    dangerGlow: "rgba(198, 67, 67, 0.38)",
    foreground: "#3760bf",
    logMinimapBackground: "#d5d6db",
    logMinimapOverlayBackground: "rgba(97, 114, 176, 0.12)",
    logMinimapOverlayBorder: "rgba(64, 148, 163, 0.3)",
    logMinimapStderr: "rgba(198, 67, 67, 0.88)",
    logMinimapStdout: "rgba(55, 96, 191, 0.16)",
    logPreviewStderrBackground: "rgba(198, 67, 67, 0.12)",
    logPreviewStderrForeground: "#c64343",
    mutedForeground: "#6172b0",
    selectionBackground: "#b7c1e3",
    selectionBorder: "#2e7de9",
    successBackground: "#387068",
    successGlow: "rgba(56, 112, 104, 0.35)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  radii: sharedRadii,
  terminal: lightTerminalColors,
  sizes: sharedSizes,
  shadows: sharedShadows,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};
const darkDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#7aa2f7",
    accentForeground: "#11121a",
    backdrop: "rgba(26, 27, 38, 0.76)",
    background: "#24283b",
    border: "#565f89",
    dangerBackground: "#f7768e",
    dangerForeground: "#f7768e",
    dangerGlow: "rgba(247, 118, 142, 0.32)",
    foreground: "#c0caf5",
    logMinimapBackground: "#1f2335",
    logMinimapOverlayBackground: "rgba(86, 95, 137, 0.24)",
    logMinimapOverlayBorder: "rgba(125, 207, 255, 0.28)",
    logMinimapStderr: "rgba(247, 118, 142, 0.9)",
    logMinimapStdout: "rgba(192, 202, 245, 0.14)",
    logPreviewStderrBackground: "#6a333e",
    logPreviewStderrForeground: "#ffffff",
    mutedForeground: "#a9b1d6",
    selectionBackground: "#2e3c64",
    selectionBorder: "#7aa2f7",
    successBackground: "#73daca",
    successGlow: "rgba(115, 218, 202, 0.34)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  radii: sharedRadii,
  terminal: darkTerminalColors,
  sizes: sharedSizes,
  shadows: sharedShadows,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};

export function getDevtoolsTheme(colorScheme: DevtoolsColorScheme): IDevtoolsTheme {
  return colorScheme === "dark" ? darkDevtoolsTheme : lightDevtoolsTheme;
}
