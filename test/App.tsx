import { createRoot } from "react-dom/client";

function App(): React.JSX.Element {
  return (
    <main className="app-shell">
      <h1 className="app-title">Hello from Bun + React</h1>
      <p className="app-lead">
        This test app is intentionally generic. It does not know anything about devhost or proxy-side injection.
      </p>
      <ul className="app-list">
        <li>
          Served by <span className="app-code">Bun.serve()</span>
        </li>
        <li>
          HTML entrypoint imports <span className="app-code">./App.tsx</span>
        </li>
        <li>React mounts into the root element at runtime</li>
      </ul>
    </main>
  );
}

const rootElement: HTMLElement | null = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root element in test/index.html");
}

const root = createRoot(rootElement);
root.render(<App />);
