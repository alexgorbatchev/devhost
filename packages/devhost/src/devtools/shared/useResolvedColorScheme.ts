import { useEffect, useState } from "react";

import type { DevtoolsColorScheme } from "./devtoolsTheme";
import { resolveDocumentColorScheme } from "./resolveDocumentColorScheme";

const darkColorSchemeMediaQuery: string = "(prefers-color-scheme: dark)";

export function useResolvedColorScheme(): DevtoolsColorScheme {
  const [colorScheme, setColorScheme] = useState<DevtoolsColorScheme>(() => {
    return getCurrentColorScheme();
  });

  useEffect(() => {
    const mediaQueryList: MediaQueryList = window.matchMedia(darkColorSchemeMediaQuery);
    const updateColorScheme = (): void => {
      setColorScheme(resolveCurrentColorScheme(document.documentElement, mediaQueryList));
    };
    const mutationObserver = new MutationObserver(() => {
      updateColorScheme();
    });

    mutationObserver.observe(document.documentElement, {
      attributeFilter: ["class", "data-theme", "style"],
      attributes: true,
    });
    mediaQueryList.addEventListener("change", updateColorScheme);
    updateColorScheme();

    return () => {
      mutationObserver.disconnect();
      mediaQueryList.removeEventListener("change", updateColorScheme);
    };
  }, []);

  return colorScheme;
}

function getCurrentColorScheme(): DevtoolsColorScheme {
  return resolveCurrentColorScheme(document.documentElement, window.matchMedia(darkColorSchemeMediaQuery));
}

function resolveCurrentColorScheme(
  documentElement: HTMLElement,
  mediaQueryList: Pick<MediaQueryList, "matches">,
): DevtoolsColorScheme {
  const computedColorScheme: string = window.getComputedStyle(documentElement).getPropertyValue("color-scheme");

  return resolveDocumentColorScheme(computedColorScheme, mediaQueryList.matches);
}
