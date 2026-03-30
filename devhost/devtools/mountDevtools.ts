import { TIME_OUTPUT_ID, TOOLBAR_BUTTON_ID } from "./constants";
import { fetchCurrentTime } from "./fetchCurrentTime";

export function mountDevtools(): void {
  if (document.getElementById(TOOLBAR_BUTTON_ID) !== null) {
    return;
  }

  const mountToolbar = (): void => {
    if (document.body === null || document.getElementById(TOOLBAR_BUTTON_ID) !== null) {
      return;
    }

    const button: HTMLButtonElement = document.createElement("button");
    button.id = TOOLBAR_BUTTON_ID;
    button.type = "button";
    button.textContent = "Append devhost time";
    applyButtonStyles(button);

    const output: HTMLDivElement = document.createElement("div");
    output.id = TIME_OUTPUT_ID;
    applyOutputStyles(output);

    button.addEventListener("click", async () => {
      try {
        const currentTime: string = await fetchCurrentTime();
        const line: HTMLDivElement = document.createElement("div");
        line.textContent = currentTime;
        output.append(line);
      } catch (error: unknown) {
        output.textContent = error instanceof Error ? error.message : String(error);
      }
    });

    document.body.append(button, output);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountToolbar, { once: true });
    return;
  }

  mountToolbar();
}

function applyButtonStyles(button: HTMLButtonElement): void {
  button.style.position = "fixed";
  button.style.right = "16px";
  button.style.bottom = "16px";
  button.style.zIndex = "2147483647";
  button.style.padding = "10px 14px";
  button.style.border = "1px solid #111827";
  button.style.borderRadius = "999px";
  button.style.background = "#111827";
  button.style.color = "#ffffff";
  button.style.fontFamily = "system-ui, sans-serif";
  button.style.fontSize = "14px";
  button.style.cursor = "pointer";
}

function applyOutputStyles(output: HTMLDivElement): void {
  output.style.position = "fixed";
  output.style.right = "16px";
  output.style.bottom = "64px";
  output.style.zIndex = "2147483647";
  output.style.maxWidth = "320px";
  output.style.padding = "12px";
  output.style.border = "1px solid #d1d5db";
  output.style.borderRadius = "12px";
  output.style.background = "#ffffff";
  output.style.color = "#111827";
  output.style.fontFamily = "system-ui, sans-serif";
  output.style.fontSize = "14px";
  output.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.12)";
}
