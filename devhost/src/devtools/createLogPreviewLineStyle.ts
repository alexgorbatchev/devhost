import type { JSX } from "preact";

import type { IDevtoolsTheme } from "./devtoolsTheme";
import type { ServiceLogEntry } from "./types";

export function createLogPreviewLineStyle(
  theme: IDevtoolsTheme,
  stream: ServiceLogEntry["stream"],
): JSX.CSSProperties {
  const isStderr: boolean = stream === "stderr";

  return {
    height: theme.sizes.logPreviewRowHeight,
    padding: `0 ${theme.spacing.xs}`,
    boxSizing: "border-box",
    background: isStderr ? theme.colors.logPreviewStderrBackground : undefined,
    color: isStderr ? theme.colors.logPreviewStderrForeground : theme.colors.foreground,
    lineHeight: theme.sizes.logPreviewRowHeight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "pre",
  };
}
