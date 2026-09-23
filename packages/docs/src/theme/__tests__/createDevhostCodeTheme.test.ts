import { describe, expect, it } from "bun:test";

import { createDevhostCodeTheme } from "../createDevhostCodeTheme";
import { fixture_darkCodeThemePalette } from "./fixtures";
import { renderTokens } from "./helpers";

describe("createDevhostCodeTheme", () => {
  it("colors TOML the way the docs design reference does", async () => {
    const tokens = await renderTokens(
      createDevhostCodeTheme(fixture_darkCodeThemePalette),
      '[services.api]\nport = 4000\nmanaged = false\nhost = "api.foo.localhost"\n# comment',
      "toml",
    );

    expect(tokens).toMatchInlineSnapshot(`
      [
        {
          "style": "--0:#A3ABB6",
          "text": "[",
        },
        {
          "style": "--0:#FF5CD6;--0fw:bold",
          "text": "services",
        },
        {
          "style": "--0:#ECEFF3",
          "text": ".",
        },
        {
          "style": "--0:#FF5CD6;--0fw:bold",
          "text": "api",
        },
        {
          "style": "--0:#A3ABB6",
          "text": "]",
        },
        {
          "style": "--0:#ECEFF3",
          "text": "port ",
        },
        {
          "style": "--0:#A3ABB6",
          "text": "=",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#FFB224",
          "text": "4000",
        },
        {
          "style": "--0:#ECEFF3",
          "text": "managed ",
        },
        {
          "style": "--0:#A3ABB6",
          "text": "=",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#FFB224",
          "text": "false",
        },
        {
          "style": "--0:#ECEFF3",
          "text": "host ",
        },
        {
          "style": "--0:#A3ABB6",
          "text": "=",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#3DDC84",
          "text": ""api.foo.localhost"",
        },
        {
          "style": "--0:#828993;--0fs:italic",
          "text": "# comment",
        },
      ]
    `);
  });

  it("colors JSON keys as foreground and strings as ok", async () => {
    const tokens = await renderTokens(
      createDevhostCodeTheme(fixture_darkCodeThemePalette),
      '{ "dev": "devhost" }',
      "json",
    );

    expect(tokens).toMatchInlineSnapshot(`
      [
        {
          "style": "--0:#A3ABB6",
          "text": "{",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#A3ABB6",
          "text": """,
        },
        {
          "style": "--0:#ECEFF3",
          "text": "dev",
        },
        {
          "style": "--0:#A3ABB6",
          "text": """,
        },
        {
          "style": "--0:#A3ABB6",
          "text": ":",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#3DDC84",
          "text": ""devhost"",
        },
        {
          "style": "--0:#ECEFF3",
          "text": " ",
        },
        {
          "style": "--0:#A3ABB6",
          "text": "}",
        },
      ]
    `);
  });
});
