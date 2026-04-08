interface IClassListLike {
  contains: (token: string) => boolean;
}

interface IEventTargetWithTagName {
  classList?: IClassListLike;
  tagName: string;
}

type EventTargetWithTagName = EventTarget & IEventTargetWithTagName;

const xtermKeyboardInputClassName: string = "xterm-helper-textarea";
const textareaTagName: string = "TEXTAREA";

export function isEventTargetTerminalKeyboardInput(target: EventTarget | null): boolean {
  if (!isEventTargetWithTagName(target)) {
    return false;
  }

  return target.tagName.toUpperCase() === textareaTagName && target.classList?.contains(xtermKeyboardInputClassName) === true;
}

function isEventTargetWithTagName(target: EventTarget | null): target is EventTargetWithTagName {
  if (typeof target !== "object" || target === null) {
    return false;
  }

  const tagName: unknown = Reflect.get(target, "tagName");

  if (typeof tagName !== "string") {
    return false;
  }

  const classList: unknown = Reflect.get(target, "classList");

  return classList === undefined || isClassListLike(classList);
}

function isClassListLike(classList: unknown): classList is IClassListLike {
  if (typeof classList !== "object" || classList === null) {
    return false;
  }

  return typeof Reflect.get(classList, "contains") === "function";
}
