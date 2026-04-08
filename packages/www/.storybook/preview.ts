import type { Preview } from "@storybook/react-vite";

import "../src/app/App.css";

const themeStorageKey: string = "devhost-test-theme";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
  },
  beforeEach() {
    window.localStorage.removeItem(themeStorageKey);
    Reflect.deleteProperty(document.documentElement.dataset, "theme");

    return (): void => {
      window.localStorage.removeItem(themeStorageKey);
      Reflect.deleteProperty(document.documentElement.dataset, "theme");
    };
  },
};

export default preview;
