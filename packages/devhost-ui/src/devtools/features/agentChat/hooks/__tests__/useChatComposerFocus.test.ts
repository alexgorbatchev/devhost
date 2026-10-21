import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { useChatComposerFocus, type IChatComposerFocusOptions } from "../useChatComposerFocus";

afterEach(() => document.body.replaceChildren());

// The composer mounts with the chat, so its ref is attached before the hook first runs its effect.
function renderComposerFocus(options: IChatComposerFocusOptions, composer: HTMLTextAreaElement): void {
  const composerReference = useChatComposerFocus(options);
  composerReference.current = composer;
}

interface IComposerScene {
  composer: HTMLTextAreaElement;
  outside: HTMLButtonElement;
}

function createComposer(): IComposerScene {
  const composer = document.createElement("textarea");
  const outside = document.createElement("button");
  composer.value = "Keep this draft";
  outside.textContent = "Page control";
  document.body.append(composer, outside);
  outside.focus();
  return { composer, outside };
}

test("focuses the composer, caret at the end, when the chat opens and when page context is added", async () => {
  const { composer, outside } = createComposer();
  const hook = renderHook((options: IChatComposerFocusOptions) => renderComposerFocus(options, composer), {
    initialProps: { isOpen: false, contextCount: 0 },
  });

  await act(async () => hook.rerender({ isOpen: false, contextCount: 1 }));
  expect(document.activeElement).toBe(outside);

  await act(async () => hook.rerender({ isOpen: true, contextCount: 1 }));
  expect(document.activeElement).toBe(composer);
  expect(composer.selectionStart).toBe(composer.value.length);
  expect(composer.selectionEnd).toBe(composer.value.length);

  outside.focus();
  await act(async () => hook.rerender({ isOpen: true, contextCount: 0 }));
  expect(document.activeElement).toBe(outside);

  await act(async () => hook.rerender({ isOpen: true, contextCount: 1 }));
  expect(document.activeElement).toBe(composer);

  outside.focus();
  await act(async () => hook.rerender({ isOpen: true, contextCount: 1 }));
  expect(document.activeElement).toBe(outside);

  await act(async () => hook.rerender({ isOpen: false, contextCount: 1 }));
  await act(async () => hook.rerender({ isOpen: true, contextCount: 1 }));
  expect(document.activeElement).toBe(composer);
});

test("a chat restored open leaves the page focus alone", async () => {
  const { composer, outside } = createComposer();
  const hook = renderHook((options: IChatComposerFocusOptions) => renderComposerFocus(options, composer), {
    initialProps: { isOpen: true, contextCount: 2 },
  });

  await act(async () => hook.rerender({ isOpen: true, contextCount: 2 }));
  expect(document.activeElement).toBe(outside);
});
