import type { ButtonVariant } from "../../shared/Button";

interface IPiTerminalPrimaryAction {
  label: string;
  testId: string;
  title: string;
  variant: ButtonVariant;
}

export function readPiTerminalPrimaryAction(hasExited: boolean): IPiTerminalPrimaryAction {
  if (hasExited) {
    return {
      label: "Close",
      testId: "PiTerminalPanel--close",
      title: "Close terminal session",
      variant: "secondary",
    };
  }

  return {
    label: "Terminate",
    testId: "PiTerminalPanel--terminate",
    title: "Terminate terminal session",
    variant: "danger",
  };
}
