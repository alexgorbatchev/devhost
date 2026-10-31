import { expect, test } from "bun:test";
import { formatAgentActivity } from "../formatAgentActivity";

const NOW = 1_000_000_000;

for (const [secondsAgo, expected] of [
  [0, "just now"],
  [59, "just now"],
  [60, "1m ago"],
  [3599, "59m ago"],
  [3600, "1h ago"],
  [86_399, "23h ago"],
  [86_400, "1d ago"],
] as const) {
  test(`${secondsAgo} seconds ago reads ${expected}`, () => {
    expect(formatAgentActivity(NOW - secondsAgo * 1000, NOW)).toBe(expected);
  });
}

test("a clock that disagrees does not read as the future", () => {
  expect(formatAgentActivity(NOW + 60_000, NOW)).toBe("just now");
});
