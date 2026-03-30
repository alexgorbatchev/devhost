import type { JSX } from "preact";

export interface IDevtoolsTheme {
  colors: {
    accentBackground: string;
    accentForeground: string;
    background: string;
    border: string;
    dangerForeground: string;
    foreground: string;
    mutedForeground: string;
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

export const devtoolsTheme: IDevtoolsTheme = {
  colors: {
    accentBackground: "#111827",
    accentForeground: "#ffffff",
    background: "#ffffff",
    border: "#d1d5db",
    dangerForeground: "#b91c1c",
    foreground: "#111827",
    mutedForeground: "#6b7280",
  },
  fontFamilies: {
    body: '"Maple Mono Normal NF", "JetBrainsMono Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    monospace: '"Maple Mono Normal NF", "JetBrainsMono Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  },
  fontSizes: {
    lg: "16px",
    md: "14px",
    sm: "12px",
  },
  radii: {
    lg: "12px",
    pill: "999px",
  },
  shadows: {
    floating: "0 10px 30px rgba(0, 0, 0, 0.12)",
  },
  spacing: {
    lg: "16px",
    md: "12px",
    sm: "10px",
    xl: "64px",
    xs: "8px",
  },
  zIndices: {
    floating: 2147483647,
  },
};
