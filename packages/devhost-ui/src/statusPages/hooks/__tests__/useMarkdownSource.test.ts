import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useMarkdownSource } from "../useMarkdownSource";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.removeItem("devhost.files.markdown.source");
});

test("restores the source choice in a new viewer and saves a return to rendered mode", () => {
  const viewer = renderHook(() => useMarkdownSource());
  expect(viewer.result.current.isSource).toBe(false);
  act(() => viewer.result.current.toggleSource());
  expect(viewer.result.current.isSource).toBe(true);
  viewer.unmount();
  const next = renderHook(() => useMarkdownSource());
  expect(next.result.current.isSource).toBe(true);
  act(() => next.result.current.toggleSource());
  expect(next.result.current.isSource).toBe(false);
  expect(localStorage.getItem("devhost.files.markdown.source")).toBe("false");
});

test("keeps the view toggle usable when browser storage is denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  const viewer = renderHook(() => useMarkdownSource());
  expect(viewer.result.current.isSource).toBe(false);
  act(() => viewer.result.current.toggleSource());
  expect(viewer.result.current.isSource).toBe(true);
  act(() => viewer.result.current.toggleSource());
  expect(viewer.result.current.isSource).toBe(false);
});
