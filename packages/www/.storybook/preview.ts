import type { Preview } from "@storybook/react-vite";

import "../src/app/App.css";

const themeStorageKey: string = "devhost-test-theme";

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: {
      default: "darker light",
      values: [
        { name: "darker light", value: "#f3f4f6" },
        { name: "dark", value: "#1f2937" },
        { name: "light", value: "#ffffff" },
      ],
    },
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
