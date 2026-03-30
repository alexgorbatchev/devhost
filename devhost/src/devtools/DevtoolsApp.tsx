import type { JSX } from "preact";
import { useState } from "preact/hooks";

import { TIME_OUTPUT_ID, TOOLBAR_BUTTON_ID } from "./constants";
import { fetchCurrentTime } from "./fetchCurrentTime";

const buttonStyle: JSX.CSSProperties = {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: "2147483647",
  padding: "10px 14px",
  border: "1px solid #111827",
  borderRadius: "999px",
  background: "#111827",
  color: "#ffffff",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  cursor: "pointer",
};

const outputStyle: JSX.CSSProperties = {
  position: "fixed",
  right: "16px",
  bottom: "64px",
  zIndex: "2147483647",
  maxWidth: "320px",
  padding: "12px",
  border: "1px solid #d1d5db",
  borderRadius: "12px",
  background: "#ffffff",
  color: "#111827",
  fontFamily: "system-ui, sans-serif",
  fontSize: "14px",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.12)",
};

export function DevtoolsApp(): JSX.Element {
  const [lines, setLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAppendTime = async (): Promise<void> => {
    try {
      const currentTime: string = await fetchCurrentTime();
      setLines((currentLines) => [...currentLines, currentTime]);
      setErrorMessage(null);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button id={TOOLBAR_BUTTON_ID} style={buttonStyle} type="button" onClick={handleAppendTime}>
        Append devhost time
      </button>
      <div id={TIME_OUTPUT_ID} style={outputStyle}>
        {errorMessage !== null ? <div>{errorMessage}</div> : null}
        {lines.map((line, index) => (
          <div key={`${line}-${index}`}>{line}</div>
        ))}
      </div>
    </>
  );
}
