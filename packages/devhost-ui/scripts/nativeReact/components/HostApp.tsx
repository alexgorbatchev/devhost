import { useState, type JSX } from "react";

interface IHostAppProps {
  projectName: string;
}

export function HostApp({ projectName }: IHostAppProps): JSX.Element {
  const [count, setCount] = useState<number>(0);
  return (
    <main data-testid="HostApp">
      <h1>Real host {projectName}</h1>
      <output aria-label="Host count">{count}</output>
      <button type="button" onClick={(): void => setCount((value) => value + 1)}>
        Increment host {projectName}
      </button>
    </main>
  );
}
