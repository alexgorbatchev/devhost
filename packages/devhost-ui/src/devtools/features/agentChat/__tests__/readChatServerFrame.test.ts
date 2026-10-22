import { expect, test } from "bun:test";
import { readChatHarnesses, readChatServerFrame } from "../readChatServerFrame";

test("native payloads and exact request ID identities survive envelope validation", () => {
  const payload = { future: { fields: ["preserved", 4] } };
  const frame = readChatServerFrame({
    type: "snapshot",
    sessionId: "session",
    session: { id: "session", harness: "codex", projectRootPath: "/project", status: "requires_action" },
    events: [{ sequence: 1, payload }],
    pendingRequestIds: [4, "4"],
  });
  expect(frame).toMatchObject({ events: [{ payload }], pendingRequestIds: [4, "4"] });
});
test("malformed envelopes are rejected before entering the native runtime", () => {
  expect(() => readChatServerFrame({ type: "event", sessionId: "session", sequence: -1, payload: {} })).toThrow();
  expect(() =>
    readChatServerFrame({ type: "state", sessionId: "session", session: {}, pendingRequestIds: [false] }),
  ).toThrow();
  expect(() =>
    readChatServerFrame({ type: "event", sessionId: "session", sequence: Number.MAX_SAFE_INTEGER + 1, payload: {} }),
  ).toThrow();
});
test("catalog validation keeps the model fields chat offers and drops native capabilities", () => {
  expect(
    readChatHarnesses({
      harnesses: [
        {
          id: "claude-code",
          label: "Claude Code",
          available: true,
          models: [
            {
              id: "model",
              label: "Model",
              description: "Native",
              metadata: { supportsEffort: true, supportedEffortLevels: ["low", "high"] },
            },
          ],
        },
      ],
    }),
  ).toEqual([
    {
      id: "claude-code",
      label: "Claude Code",
      available: true,
      models: [{ id: "model", label: "Model", description: "Native" }],
    },
  ]);
});
