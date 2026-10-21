/** Isolate devhost settings without touching the host application's storage. */
export function resetDevtoolsSettingsStorage(): VoidFunction {
  const saved = Object.entries(localStorage).filter(([key]) => key.startsWith("devhost:settings:"));
  for (const [key] of saved) localStorage.removeItem(key);
  return () => {
    for (const key of Object.keys(localStorage).filter((key) => key.startsWith("devhost:settings:")))
      localStorage.removeItem(key);
    for (const [key, value] of saved) localStorage.setItem(key, value);
  };
}
