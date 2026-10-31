import { expect, test } from "bun:test";
import { isChatRequestSettled } from "../isChatRequestSettled";
import type { ChatDeliveryState, ChatSessionStatus, IChatSession } from "../types";

const request = { sessionId: "s", commandId: "c" };
const session = (status: ChatSessionStatus, id = "s"): IChatSession => ({
  id,
  harness: "claude-code",
  projectRootPath: "/project",
  status,
});
const reading = (state?: ChatDeliveryState) => () => state;

test("is pending while native frames show the message queued or started", () => {
  for (const state of ["queued", "started"] as const) {
    expect(isChatRequestSettled(request, [], session("idle"), reading(state))).toBe(false);
  }
});

test("a queued message outlasts the end of the turn", () => {
  expect(isChatRequestSettled(request, [], session("idle"), reading("queued"))).toBe(false);
});

test("is settled once the message finished, was stopped, or failed", () => {
  for (const state of ["completed", "cancelled", "failed"] as const) {
    expect(isChatRequestSettled(request, [], session("running"), reading(state))).toBe(true);
  }
});

test("without frames only an idle session settles it", () => {
  expect(isChatRequestSettled(request, [], session("running"), reading())).toBe(false);
  expect(isChatRequestSettled(request, [], session("idle"), reading())).toBe(true);
});

test("is settled when its session has ended or is gone", () => {
  expect(isChatRequestSettled(request, [], null, reading("started"))).toBe(true);
  expect(isChatRequestSettled(request, [session("closed")], null, reading("started"))).toBe(true);
  expect(isChatRequestSettled(request, [session("error")], null, reading("started"))).toBe(true);
});

test("stays pending while another conversation is open", () => {
  expect(isChatRequestSettled(request, [session("running")], session("idle", "other"), reading())).toBe(false);
});
