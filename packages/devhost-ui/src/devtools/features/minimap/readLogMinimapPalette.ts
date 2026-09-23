import type { DevtoolsColorScheme } from "../../shared";

export interface ILogMinimapPalette {
  stderr: string;
  stdout: string;
}

// Canvas marks are painted from JavaScript, so these mirror the `--faint` (stdout) and `--destructive` (stderr)
// tokens in shared/devtools.css.
export function readLogMinimapPalette(colorScheme: DevtoolsColorScheme): ILogMinimapPalette {
  if (colorScheme === "dark") {
    return {
      stderr: "#ff6159",
      stdout: "#6f7783",
    };
  }

  return {
    stderr: "#cc1f1f",
    stdout: "#7c8490",
  };
}
