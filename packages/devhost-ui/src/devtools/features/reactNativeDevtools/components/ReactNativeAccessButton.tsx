import type { JSX } from "react";
import { Button } from "../../../shared";
import { ToolbarSegment } from "../../../shared/components/ToolbarSegment";

interface IReactNativeAccessButtonProps {
  isAvailable: boolean;
  isActionPending: boolean;
  onOpen: () => void;
}

export function ReactNativeAccessButton({
  isAvailable,
  isActionPending,
  onOpen,
}: IReactNativeAccessButtonProps): JSX.Element | null {
  if (!isAvailable) return null;
  return (
    <ToolbarSegment ariaLabel="React native devtools" testId="ReactNativeAccessButton">
      <Button
        title="Open native DevTools for this React host; select Components or Profiler there"
        disabled={isActionPending}
        onClick={onOpen}
      >
        React DevTools
      </Button>
    </ToolbarSegment>
  );
}
