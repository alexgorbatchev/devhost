import { useEffect, useState, type ChangeEvent, type JSX } from "react";
import { createRoot } from "react-dom/client";

type ThemePreference = "system" | "light" | "dark";

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const themeStorageKey: string = "devhost-test-theme";
const darkColorSchemeMediaQuery: string = "(prefers-color-scheme: dark)";

function App(): JSX.Element {
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    return readStoredThemePreference(window.localStorage);
  });

  useEffect(() => {
    applyThemePreference(document.documentElement, themePreference, window.matchMedia(darkColorSchemeMediaQuery));
    window.localStorage.setItem(themeStorageKey, themePreference);

    if (themePreference !== "system") {
      return;
    }

    const mediaQueryList: MediaQueryList = window.matchMedia(darkColorSchemeMediaQuery);
    const handleChange = (): void => {
      applyThemePreference(document.documentElement, themePreference, mediaQueryList);
    };

    mediaQueryList.addEventListener("change", handleChange);

    return () => {
      mediaQueryList.removeEventListener("change", handleChange);
    };
  }, [themePreference]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1 className="app-title">Hello from Bun + React</h1>
          <p className="app-lead">
            This test app is intentionally generic. It does not know anything about devhost or proxy-side injection.
          </p>
        </div>
        <label className="theme-toggle" htmlFor="theme-preference">
          <span className="theme-toggle__label">Theme</span>
          <select
            id="theme-preference"
            className="theme-toggle__control"
            value={themePreference}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setThemePreference(parseThemePreference(event.currentTarget.value));
            }}
          >
            {themeOptions.map((themeOption) => {
              return (
                <option key={themeOption.value} value={themeOption.value}>
                  {themeOption.label}
                </option>
              );
            })}
          </select>
        </label>
      </header>
      <ul className="app-list">
        <li>
          Served by <span className="app-code">Bun.serve()</span>
        </li>
        <li>
          HTML entrypoint imports <span className="app-code">./App.tsx</span>
        </li>
        <li>React mounts into the root element at runtime</li>
        <li>The theme toggle updates the document color scheme using standard browser primitives</li>
      </ul>
    </main>
  );
}

function readStoredThemePreference(storage: Pick<Storage, "getItem">): ThemePreference {
  return parseThemePreference(storage.getItem(themeStorageKey));
}

function parseThemePreference(value: string | null): ThemePreference {
  if (value === "system" || value === "light" || value === "dark") {
    return value;
  }

  return "system";
}

function applyThemePreference(
  documentElement: HTMLElement,
  themePreference: ThemePreference,
  mediaQueryList: Pick<MediaQueryList, "matches">,
): void {
  const resolvedThemePreference: Exclude<ThemePreference, "system"> =
    themePreference === "system" ? (mediaQueryList.matches ? "dark" : "light") : themePreference;

  documentElement.dataset.theme = themePreference;
  documentElement.style.colorScheme = resolvedThemePreference;
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root element in test/index.html");
}

const root = createRoot(rootElement);
root.render(<App />);
