import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { TIME_OUTPUT_ID, TOOLBAR_BUTTON_ID } from "./constants";
import { devtoolsTheme } from "./devtoolsTheme";
import { fetchCurrentTime } from "./fetchCurrentTime";

const buttonStyle: JSX.CSSProperties = {
  position: "fixed",
  right: devtoolsTheme.spacing.lg,
  bottom: devtoolsTheme.spacing.lg,
  zIndex: devtoolsTheme.zIndices.floating,
  padding: `${devtoolsTheme.spacing.sm} ${devtoolsTheme.spacing.md}`,
  border: `1px solid ${devtoolsTheme.colors.foreground}`,
  borderRadius: devtoolsTheme.radii.pill,
  background: devtoolsTheme.colors.accentBackground,
  color: devtoolsTheme.colors.accentForeground,
  fontFamily: devtoolsTheme.fontFamilies.monospace,
  fontSize: devtoolsTheme.fontSizes.md,
  cursor: "pointer",
};

const outputStyle: JSX.CSSProperties = {
  position: "fixed",
  right: devtoolsTheme.spacing.lg,
  bottom: devtoolsTheme.spacing.xl,
  zIndex: devtoolsTheme.zIndices.floating,
  maxWidth: "320px",
  padding: devtoolsTheme.spacing.md,
  border: `1px solid ${devtoolsTheme.colors.border}`,
  borderRadius: devtoolsTheme.radii.lg,
  background: devtoolsTheme.colors.background,
  color: devtoolsTheme.colors.foreground,
  fontFamily: devtoolsTheme.fontFamilies.monospace,
  fontSize: devtoolsTheme.fontSizes.md,
  boxShadow: devtoolsTheme.shadows.floating,
};

const errorStyle: JSX.CSSProperties = {
  color: devtoolsTheme.colors.dangerForeground,
  marginBottom: devtoolsTheme.spacing.xs,
};

const lineStyle: JSX.CSSProperties = {
  color: devtoolsTheme.colors.foreground,
};

export function DevtoolsApp(): JSX.Element {
  const [lines, setLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAppendTime = async (): Promise<void> => {
    try {
      const currentTime: string = await fetchCurrentTime();
      setLines((currentLines) => [...currentLines, currentTime]);
      setErrorMessage(null);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button id={TOOLBAR_BUTTON_ID} style={buttonStyle} type="button" onClick={handleAppendTime}>
        Append devhost time
      </button>
      <div id={TIME_OUTPUT_ID} style={outputStyle}>
        {errorMessage !== null ? <div style={errorStyle}>{errorMessage}</div> : null}
        {lines.map((line, index) => (
          <div key={`${line}-${index}`} style={lineStyle}>
            {line}
          </div>
        ))}
      </div>
    </>
  );
}
