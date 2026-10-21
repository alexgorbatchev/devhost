import type { JSX } from "react";
import { JotaiDemo } from "./JotaiDemo";
import { ReactHookFormDemo } from "./ReactHookFormDemo";
import { StoreDevtoolsDemo } from "./StoreDevtoolsDemo";
import { TanStackLibrariesDemo } from "./TanStackLibrariesDemo";

// Every third-party inspector the devhost toolbar gathers, mounted on one page with real library state.
export function InspectorsPlayground(): JSX.Element {
  return (
    <div className="inspector-demos">
      <TanStackLibrariesDemo />
      <ReactHookFormDemo />
      <JotaiDemo />
      <StoreDevtoolsDemo />
    </div>
  );
}
