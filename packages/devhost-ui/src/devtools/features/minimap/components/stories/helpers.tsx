import type { JSX } from "react";
import { useState } from "react";

import { Button } from "../../../../../components/ui/Button";
import { StorybookThemeProvider } from "../../../../shared/components/stories/helpers";
import type { DevtoolsColorScheme } from "../../../../shared/DevtoolsColorScheme";
import type { ServiceLogEntry } from "../../../../shared/types";
import { LogMinimap } from "../LogMinimap";
import { fixture_ansiContrastEntries } from "./fixtures";

export function LogMinimapLiveEntriesHarness(): JSX.Element {
  const [entries, setEntries] = useState<ServiceLogEntry[]>([
    { id: 1, serviceName: "api", line: "Ready", stream: "stdout" },
  ]);
  return (
    <>
      <Button
        onClick={() =>
          setEntries([
            ...entries,
            { id: entries.length + 1, serviceName: "long-background-worker", line: "Working", stream: "stdout" },
          ])
        }
      >
        Append worker output
      </Button>
      <LogMinimap
        entries={entries}
        serviceNames={["api", "long-background-worker"]}
        isHovered
        onHoveredChange={() => {}}
      />
    </>
  );
}

export function LogMinimapThemeChangeHarness(): JSX.Element {
  const [colorScheme, setColorScheme] = useState<DevtoolsColorScheme>("dark");
  return (
    <StorybookThemeProvider globals={{ devhostTheme: colorScheme }}>
      <Button onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}>
        Switch to {colorScheme === "dark" ? "light" : "dark"}
      </Button>
      <LogMinimap entries={fixture_ansiContrastEntries} isHovered onHoveredChange={() => {}} />
    </StorybookThemeProvider>
  );
}
