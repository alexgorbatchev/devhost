export type ColorScheme = "dark" | "light";

/** Surface, text, line, and status colors that change with the color scheme. */
export interface ISchemePalette {
  surface: string;
  surface2: string;
  surface3: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  line: string;
  edge: string;
  halo: string;
  shadow: string;
  accent: string;
  onAccent: string;
  ok: string;
  onOk: string;
  warn: string;
  onWarn: string;
  danger: string;
  onDanger: string;
  dangerSoft: string;
  backdrop: string;
  termBg: string;
}

/** Host-content markers: identical in both schemes because they are drawn over arbitrary host-page pixels. */
export interface IMarkPalette {
  mark: string;
  markInk: string;
  markAlt: string;
  markHaloIn: string;
  markHaloOut: string;
}

export interface IShapeTokens {
  radiusSm: string;
  radiusMd: string;
}

/** xterm.js renders from JavaScript options, so terminals take literal colors rather than custom properties. */
export interface ITerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface IDesignTokens {
  schemes: Record<ColorScheme, ISchemePalette>;
  marks: IMarkPalette;
  shape: IShapeTokens;
}
