import type { JSX } from "preact";

export type DevtoolsColorScheme = "light" | "dark";

export interface IDevtoolsTheme {
  colors: {
    accentBackground: string;
    accentForeground: string;
    background: string;
    border: string;
    dangerBackground: string;
    dangerForeground: string;
    dangerGlow: string;
    foreground: string;
    mutedForeground: string;
    successBackground: string;
    successGlow: string;
  };
  fontFamilies: {
    body: string;
    monospace: string;
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
  };
  shadows: {
    floating: string;
  };
  spacing: {
    lg: string;
    md: string;
    sm: string;
    xl: string;
    xs: string;
  };
  zIndices: {
    floating: JSX.CSSProperties["zIndex"];
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
const sharedRadii: IDevtoolsTheme["radii"] = {
  lg: "12px",
  md: "8px",
  pill: "999px",
};
const sharedSpacing: IDevtoolsTheme["spacing"] = {
  lg: "16px",
  md: "12px",
  sm: "10px",
  xl: "64px",
  xs: "8px",
};
const sharedZIndices: IDevtoolsTheme["zIndices"] = {
  floating: 2147483647,
};
const lightDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#111827",
    accentForeground: "#ffffff",
    background: "rgba(255, 255, 255, 0.92)",
    border: "#cbd5e1",
    dangerBackground: "#ef4444",
    dangerForeground: "#b91c1c",
    dangerGlow: "rgba(239, 68, 68, 0.45)",
    foreground: "#111827",
    mutedForeground: "#6b7280",
    successBackground: "#22c55e",
    successGlow: "rgba(34, 197, 94, 0.45)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  radii: sharedRadii,
  shadows: {
    floating: "0 10px 30px rgba(15, 23, 42, 0.12)",
  },
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};
const darkDevtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#e2e8f0",
    accentForeground: "#020617",
    background: "rgba(15, 23, 42, 0.92)",
    border: "#334155",
    dangerBackground: "#f87171",
    dangerForeground: "#fecaca",
    dangerGlow: "rgba(248, 113, 113, 0.38)",
    foreground: "#e2e8f0",
    mutedForeground: "#94a3b8",
    successBackground: "#4ade80",
    successGlow: "rgba(74, 222, 128, 0.38)",
  },
  fontFamilies: sharedFontFamilies,
  fontSizes: sharedFontSizes,
  radii: sharedRadii,
  shadows: {
    floating: "0 10px 30px rgba(2, 6, 23, 0.45)",
  },
  spacing: sharedSpacing,
  zIndices: sharedZIndices,
};

export function getDevtoolsTheme(colorScheme: DevtoolsColorScheme): IDevtoolsTheme {
  return colorScheme === "dark" ? darkDevtoolsTheme : lightDevtoolsTheme;
}
