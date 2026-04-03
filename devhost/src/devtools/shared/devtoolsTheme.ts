import type { JSX } from "preact";

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
    floating: NonNullable<JSX.CSSProperties["zIndex"]>;
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
  floating: 2147483647,
};
const sharedShadows: IDevtoolsTheme["shadows"] = {
  floating: "0px 10px 24px rgba(15, 23, 42, 0.14)",
  popup: "4px 5px 10px rgba(0, 0, 0, 0.8), -4px 5px 10px rgba(0, 0, 0, 0.4)",
};
const lightDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#111827",
    accentForeground: "#ffffff",
    backdrop: "rgba(255, 255, 255, 0.72)",
    background: "#ffffff",
    border: "#cbd5e1",
    dangerBackground: "#ef4444",
    dangerForeground: "#b91c1c",
    dangerGlow: "rgba(239, 68, 68, 0.45)",
    foreground: "#111827",
    logMinimapBackground: "#ffffff",
    logMinimapOverlayBackground: "rgba(15, 23, 42, 0.08)",
    logMinimapOverlayBorder: "rgba(15, 23, 42, 0.18)",
    logMinimapStderr: "rgba(220, 38, 38, 0.9)",
    logMinimapStdout: "rgba(15, 23, 42, 0.14)",
    logPreviewStderrBackground: "rgba(239, 68, 68, 0.12)",
    logPreviewStderrForeground: "#991b1b",
    mutedForeground: "#6b7280",
    selectionBackground: "rgba(59, 130, 246, 0.12)",
    selectionBorder: "rgba(59, 130, 246, 0.55)",
    successBackground: "#22c55e",
    successGlow: "rgba(34, 197, 94, 0.45)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  radii: sharedRadii,
  sizes: sharedSizes,
  shadows: sharedShadows,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};
const darkDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#e2e8f0",
    accentForeground: "#020617",
    backdrop: "rgba(15, 23, 42, 0.68)",
    background: "#0f172a",
    border: "#334155",
    dangerBackground: "#f87171",
    dangerForeground: "#fecaca",
    dangerGlow: "rgba(248, 113, 113, 0.38)",
    foreground: "#e2e8f0",
    logMinimapBackground: "#0f172a",
    logMinimapOverlayBackground: "rgba(148, 163, 184, 0.12)",
    logMinimapOverlayBorder: "rgba(148, 163, 184, 0.24)",
    logMinimapStderr: "rgba(248, 113, 113, 0.92)",
    logMinimapStdout: "rgba(226, 232, 240, 0.12)",
    logPreviewStderrBackground: "rgba(248, 113, 113, 0.18)",
    logPreviewStderrForeground: "#fca5a5",
    mutedForeground: "#94a3b8",
    selectionBackground: "rgba(96, 165, 250, 0.18)",
    selectionBorder: "rgba(96, 165, 250, 0.6)",
    successBackground: "#4ade80",
    successGlow: "rgba(74, 222, 128, 0.38)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  opacities: sharedOpacities,
  radii: sharedRadii,
  sizes: sharedSizes,
  shadows: sharedShadows,
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};

export function getDevtoolsTheme(colorScheme: DevtoolsColorScheme): IDevtoolsTheme {
  return colorScheme === "dark" ? darkDevtoolsTheme : lightDevtoolsTheme;
}
