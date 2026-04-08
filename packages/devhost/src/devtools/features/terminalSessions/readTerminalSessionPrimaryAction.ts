import type { ButtonVariant } from "../../shared/Button";

interface ITerminalSessionPrimaryAction {
  label: string;
  testId: string;
  title: string;
  variant: ButtonVariant;
}

export function readTerminalSessionPrimaryAction(hasExited: boolean): ITerminalSessionPrimaryAction {
  if (hasExited) {
    return {
      label: "Close",
      testId: "TerminalSessionPanel--close",
      title: "Close terminal session",
      variant: "secondary",
    };
  }

  return {
    label: "Terminate",
    testId: "TerminalSessionPanel--terminate",
    title: "Terminate terminal session",
    variant: "danger",
  };
}
