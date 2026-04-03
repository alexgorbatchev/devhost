import { readTerminalSessionKindConfig } from "./readTerminalSessionKindConfig";
import type { ITerminalSession } from "./types";

export interface ITerminalSessionSummary {
  eyebrow: string;
  headline: string;
  meta: string[];
  terminalTitle: string;
  trayTooltipPrimary: string;
  trayTooltipSecondary?: string;
}

export function readTerminalSessionSummary(session: ITerminalSession): ITerminalSessionSummary {
  const sessionKindConfig = readTerminalSessionKindConfig(session.kind);

  if (session.kind === "pi-annotation") {
    return {
      eyebrow: "Original annotation",
      headline: session.annotation.comment,
      meta: [
        `${session.annotation.markers.length} markers`,
        session.annotation.title,
        new URL(session.annotation.url).host,
        new Date(session.annotation.submittedAt).toLocaleString(),
      ],
      terminalTitle: sessionKindConfig.terminalTitle,
      trayTooltipPrimary: session.annotation.comment,
    };
  }

  return {
    eyebrow: "Component source",
    headline: `<${session.componentName}>`,
    meta: [session.sourceLabel],
    terminalTitle: sessionKindConfig.terminalTitle,
    trayTooltipPrimary: `<${session.componentName}>`,
    trayTooltipSecondary: session.sourceLabel,
  };
}
