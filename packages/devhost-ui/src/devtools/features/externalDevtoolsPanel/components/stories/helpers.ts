export function resetJotaiDevtoolsStorage(): () => void {
  const saved = Object.entries(localStorage).filter(([key]) => key.startsWith("jotai-devtools-"));
  for (const [key] of saved) localStorage.removeItem(key);

  return () => {
    for (const key of Object.keys(localStorage).filter((key) => key.startsWith("jotai-devtools-")))
      localStorage.removeItem(key);
    for (const [key, value] of saved) localStorage.setItem(key, value);
  };
}

export function resetTanStackDevtoolsStorage(): () => void {
  const keys = ["tanstack_devtools_state", "tanstack_devtools_settings", "pip_open"];
  const saved = new Map(keys.map((key) => [key, localStorage.getItem(key)]));
  for (const key of keys) localStorage.removeItem(key);
  return () => {
    for (const key of keys) localStorage.removeItem(key);
    for (const [key, value] of saved) {
      if (value !== null) localStorage.setItem(key, value);
    }
  };
}
