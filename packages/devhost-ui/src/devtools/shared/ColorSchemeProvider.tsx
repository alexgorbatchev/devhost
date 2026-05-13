import type { JSX, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

import type { DevtoolsColorScheme } from "./DevtoolsColorScheme";
import { devtoolsColorSchemeContext } from "./devtoolsColorSchemeContext";

interface IColorSchemeProviderProps {
  children: ReactNode;
  colorScheme: DevtoolsColorScheme;
}

export function ColorSchemeProvider(props: IColorSchemeProviderProps): JSX.Element {
  return (
    <devtoolsColorSchemeContext.Provider value={props.colorScheme}>
      <ThemeAnchorSynchronizer colorScheme={props.colorScheme} />
      {props.children}
    </devtoolsColorSchemeContext.Provider>
  );
}

function ThemeAnchorSynchronizer(props: Pick<IColorSchemeProviderProps, "colorScheme">): JSX.Element {
  const anchorReference = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect((): void => {
    const rootNode: Node | null = anchorReference.current?.getRootNode() ?? null;

    if (!(rootNode instanceof ShadowRoot)) {
      return;
    }

    rootNode.host.setAttribute("data-theme", props.colorScheme);
  }, [props.colorScheme]);

  return <span ref={anchorReference} hidden />;
}
