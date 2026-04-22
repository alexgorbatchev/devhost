import { useEffect, useRef } from "react";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { ReactDevtoolsHost } from "./ReactDevtoolsHost";

export function ReactDevtoolsBridge() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const root = ReactDOMClient.createRoot(rootRef.current);
    root.render(<ReactDevtoolsHost />);

    return () => {
      setTimeout(() => root.unmount(), 0);
    };
  }, []);

  return <div ref={rootRef} data-testid="ReactDevtoolsBridge" />;
}
