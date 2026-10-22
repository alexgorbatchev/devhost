import { ToggleGroup, ToggleGroupItem } from "@alexgorbatchev/shadcn";
import type { JSX } from "react";
import type { ChatTarget } from "../../../shared/types";

interface IChatTargetToggleProps {
  target: ChatTarget;
  isDisabled: boolean;
  onTargetChange: (target: ChatTarget) => void;
}

export function ChatTargetToggle({ target, isDisabled, onTargetChange }: IChatTargetToggleProps): JSX.Element {
  return (
    <ToggleGroup
      aria-label="Chat Directory"
      value={[target]}
      disabled={isDisabled}
      size="sm"
      variant="outline"
      onValueChange={(values) => {
        const value = values[0];
        if (value === "project" || value === "devhost") onTargetChange(value);
      }}
    >
      <ToggleGroupItem value="project" title="Chat In This Project">
        Project
      </ToggleGroupItem>
      <ToggleGroupItem value="devhost" title="Chat In The devhost Checkout">
        devhost
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
