import { expect, test } from "bun:test";
import { readChatRequestChanges } from "../readChatRequestChanges";
import type { IChatPendingRequest } from "../types";

const request: IChatPendingRequest = {
  requestId: 7,
  harness: "codex",
  method: "item/fileChange/requestApproval",
  payload: {
    id: 7,
    method: "item/fileChange/requestApproval",
    params: { itemId: "change", threadId: "thread", turnId: "turn" },
  },
};
test("reviews only the matching native file change from the current thread and turn", () => {
  const events = [
    {
      sequence: 1,
      payload: {
        method: "item/started",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: { id: "change", type: "fileChange", changes: [{ path: "app.ts", diff: "-before\n+after" }] },
        },
      },
    },
    {
      sequence: 2,
      payload: {
        method: "item/started",
        params: {
          threadId: "other",
          turnId: "other",
          item: { id: "change", type: "fileChange", changes: [{ path: "unrelated.ts", diff: "unrelated" }] },
        },
      },
    },
  ];
  expect(readChatRequestChanges(request, events)).toEqual([{ path: "app.ts", diff: "-before\n+after" }]);
});
test("missing native diff stays empty rather than being fabricated from another item", () => {
  expect(readChatRequestChanges(request, [])).toEqual([]);
  expect(readChatRequestChanges({ ...request, method: "item/commandExecution/requestApproval" }, [])).toEqual([]);
});
