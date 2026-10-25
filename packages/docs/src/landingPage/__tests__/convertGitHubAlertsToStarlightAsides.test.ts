import { expect, it } from "bun:test";
import { convertGitHubAlertsToStarlightAsides } from "../convertGitHubAlertsToStarlightAsides";

it.each([
  ["NOTE", ":::note[Note]"],
  ["TIP", ":::tip[Tip]"],
  ["IMPORTANT", ":::caution[Important]"],
  ["WARNING", ":::caution[Warning]"],
  ["CAUTION", ":::danger[Caution]"],
] as const)("turns a %s alert into the matching Starlight aside", (alert, opening) => {
  const markdown = `Before\n\n> [!${alert}]\n> First line.\n>\n> Second line.\n\nAfter`;

  expect(convertGitHubAlertsToStarlightAsides(markdown)).toBe(
    `Before\n\n${opening}\nFirst line.\n\nSecond line.\n:::\n\nAfter`,
  );
});

it("leaves ordinary blockquotes and text unchanged", () => {
  const markdown = "> A quote, not an alert.\n\nText";

  expect(convertGitHubAlertsToStarlightAsides(markdown)).toBe(markdown);
});

it("keeps an alert with no body as an empty aside", () => {
  expect(convertGitHubAlertsToStarlightAsides("> [!TIP]\n\nText")).toBe(":::tip[Tip]\n:::\n\nText");
});
