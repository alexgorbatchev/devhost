import { DevTools } from "jotai-devtools";
// Host application fixture stylesheet; never imported by the injected devhost runtime.
import "jotai-devtools/styles.css";
import { atom, createStore, Provider, useAtom } from "jotai";
import type { PrimitiveAtom } from "jotai";
import type { JSX } from "react";
import { useState } from "react";

import { DevtoolsToolbar } from "@/devtools/shared/components/DevtoolsToolbar";
import { StorybookThemeProvider } from "@/devtools/shared/components/stories/helpers";
import { useExternalDevtoolsLaunchers } from "@/devtools/features/externalDevtoolsPanel/hooks/useExternalDevtoolsLaunchers";
import { ExternalDevtoolsPanel } from "@/devtools/features/externalDevtoolsPanel/components/ExternalDevtoolsPanel";

const firstCount = atom(0);
firstCount.debugLabel = "firstCount";
const secondCount = atom(100);
secondCount.debugLabel = "secondCount";

interface IJotaiHarnessProps {
  globals: Partial<Record<string, unknown>>;
  hasSecondStore?: boolean;
}

interface IJotaiToolbarProps {
  globals: Partial<Record<string, unknown>>;
  isEnabled: boolean;
}

function JotaiToolbar({ globals, isEnabled }: IJotaiToolbarProps): JSX.Element {
  const { launchers, toggleLauncher } = useExternalDevtoolsLaunchers(isEnabled);
  return (
    <StorybookThemeProvider globals={globals}>
      <DevtoolsToolbar collapsedIndicator={null} isMinimapVisible={false} position="bottom-right" stackName="atoms">
        <ExternalDevtoolsPanel launchers={launchers} onToggleLauncher={toggleLauncher} />
      </DevtoolsToolbar>
    </StorybookThemeProvider>
  );
}

interface ICounterProps {
  valueAtom: PrimitiveAtom<number>;
  label: string;
}

function Counter({ valueAtom, label }: ICounterProps): JSX.Element {
  const [value, setValue] = useAtom(valueAtom);
  return (
    <div>
      <output aria-label={`${label} value`}>{value}</output>
      <button type="button" onClick={() => setValue((current) => current + 1)}>
        Increment {label}
      </button>
    </div>
  );
}

export function JotaiHarness({ globals, hasSecondStore = false }: IJotaiHarnessProps): JSX.Element {
  // DevTools' imported instrumentation must run before these custom stores are created.
  const [firstStore] = useState(createStore);
  const [secondStore] = useState(createStore);
  const [isEnabled, setIsEnabled] = useState(true);
  const [isToolbarMounted, setIsToolbarMounted] = useState(true);
  const [isInspectorMounted, setIsInspectorMounted] = useState(true);
  const [generation, setGeneration] = useState(0);

  return (
    <div data-testid="JotaiHarness">
      <button type="button" onClick={() => setIsEnabled((value) => !value)}>
        Toggle aggregation
      </button>
      <button type="button" onClick={() => setIsToolbarMounted((value) => !value)}>
        Toggle toolbar mount
      </button>
      <button type="button" onClick={() => setIsInspectorMounted((value) => !value)}>
        Toggle first inspector
      </button>
      <button type="button" onClick={() => setGeneration((value) => value + 1)}>
        Remount first inspector
      </button>
      <Provider store={firstStore}>
        <Counter valueAtom={firstCount} label="first" />
      </Provider>
      <div data-testid="JotaiHarness--first-inspector">
        {isInspectorMounted ? (
          <DevTools
            key={generation}
            store={firstStore}
            position="bottom-left"
            options={{ timeTravelPlaybackInterval: 100 }}
          />
        ) : null}
      </div>
      {hasSecondStore ? (
        <>
          <Provider store={secondStore}>
            <Counter valueAtom={secondCount} label="second" />
          </Provider>
          <div data-testid="JotaiHarness--second-inspector">
            <DevTools store={secondStore} position="bottom-right" />
          </div>
        </>
      ) : null}
      {isToolbarMounted ? <JotaiToolbar globals={globals} isEnabled={isEnabled} /> : null}
    </div>
  );
}
