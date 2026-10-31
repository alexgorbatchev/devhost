import { expect, test } from "bun:test";
import { createAgentActivityStreamURL } from "../createAgentActivityStreamURL";

test("streams from the page's own origin for the same checkout", () => {
  const url = createAgentActivityStreamURL({ host: "127.0.0.1:4000", search: "?chatTarget=project&pageURL=x" });
  expect(url).toBe("ws://127.0.0.1:4000/__devhost__/ws/agents/activity?chatTarget=project&pageURL=x");
});
