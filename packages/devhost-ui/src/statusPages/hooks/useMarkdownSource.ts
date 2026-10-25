import { useState } from "react";

interface IMarkdownSource {
  isSource: boolean;
  toggleSource: () => void;
}

const preferenceKey = "devhost.files.markdown.source";

export function useMarkdownSource(): IMarkdownSource {
  const [isSource, setSource] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  function toggleSource(): void {
    const next = !isSource;
    setSource(next);
    try {
      localStorage.setItem(preferenceKey, String(next));
    } catch {
      // Reading files still works when the browser denies storage.
    }
  }
  return { isSource, toggleSource };
}
