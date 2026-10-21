import { useEffect, useRef, type RefObject } from "react";

export interface IChatComposerFocusOptions {
  isOpen: boolean;
  /** How many page elements and drawings the next message carries. */
  contextCount: number;
}

/**
 * Moves focus to the chat composer when the chat opens and when page context is added, so the user can describe
 * what they selected or drew straight away. A chat that is already open when it mounts, as after a reload, leaves
 * the page focus alone.
 */
export function useChatComposerFocus({
  isOpen,
  contextCount,
}: IChatComposerFocusOptions): RefObject<HTMLTextAreaElement | null> {
  const composerReference = useRef<HTMLTextAreaElement | null>(null);
  const previousReference = useRef<IChatComposerFocusOptions>({ isOpen, contextCount });
  useEffect(() => {
    const previous = previousReference.current;
    previousReference.current = { isOpen, contextCount };
    const composer = composerReference.current;
    if (!isOpen || composer === null || (previous.isOpen && contextCount <= previous.contextCount)) return;
    composer.focus({ preventScroll: true });
    composer.setSelectionRange(composer.value.length, composer.value.length);
  }, [contextCount, isOpen]);
  return composerReference;
}
