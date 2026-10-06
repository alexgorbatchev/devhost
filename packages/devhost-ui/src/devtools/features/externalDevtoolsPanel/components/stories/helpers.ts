export function resetJotaiDevtoolsStorage(): () => void {
  const saved = Object.entries(localStorage).filter(([key]) => key.startsWith("jotai-devtools-"));
  for (const [key] of saved) localStorage.removeItem(key);

  return () => {
    for (const key of Object.keys(localStorage).filter((key) => key.startsWith("jotai-devtools-")))
      localStorage.removeItem(key);
    for (const [key, value] of saved) localStorage.setItem(key, value);
  };
}
