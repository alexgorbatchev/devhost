import { useEffect, useState, type ChangeEvent, type JSX } from "react";
import { createRoot } from "react-dom/client";

type ThemePreference = "system" | "light" | "dark";

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];
const diagnosticSections: Array<{ paragraphs: string[]; title: string }> = [
  {
    paragraphs: [
      "This section exists only to create realistic vertical page flow while devhost overlays remain pinned to the viewport.",
      "Scroll depth matters here because the minimap drawer should feel attached to the viewport instead of the document content.",
    ],
    title: "Viewport behavior",
  },
  {
    paragraphs: [
      "The test page intentionally mixes dense text blocks with quieter spacing so minimap visibility can be judged against different background contrast.",
      "If the minimap feels visually detached during scroll, that is a UI issue, not a content issue.",
    ],
    title: "Visual contrast",
  },
  {
    paragraphs: [
      "Longer content also helps expose whether the drawer hover affordance feels stable when the page is moving under the pointer.",
      "That interaction is easy to get subtly wrong, especially when fixed overlays compete with scrolling momentum.",
    ],
    title: "Pointer stability",
  },
  {
    paragraphs: [
      "The demo log service is synthetic on purpose. It is here to stress the minimap, not to model correct application logging discipline.",
      "That distinction matters because noisy demos often mask real usability problems instead of revealing them.",
    ],
    title: "Synthetic logging",
  },
  {
    paragraphs: [
      "With enough vertical content, you can now check whether the peeking drawer distracts from reading or remains appropriately peripheral.",
      "A good minimap should be informative without fighting the main page for attention.",
    ],
    title: "Attention balance",
  },
  {
    paragraphs: [
      "The theme toggle remains important while scrolling because the minimap and status panel should continue to respect the host document color scheme.",
      "If colors lag or feel wrong after theme changes, that is still a bug even if the drawer animation looks fine.",
    ],
    title: "Theme parity",
  },
  {
    paragraphs: [
      "This final section simply ensures the page is tall enough to test top, middle, and bottom scroll positions without special tooling.",
      "If you want even more height later, that should be added intentionally instead of relying on accidental content growth.",
    ],
    title: "Scroll depth",
  },
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
      <div className="app-sections">
        {diagnosticSections.map((diagnosticSection) => {
          return (
            <section key={diagnosticSection.title} className="app-section">
              <h2 className="app-section__title">{diagnosticSection.title}</h2>
              {diagnosticSection.paragraphs.map((paragraph) => {
                return (
                  <p key={paragraph} className="app-section__body">
                    {paragraph}
                  </p>
                );
              })}
            </section>
          );
        })}
      </div>
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
