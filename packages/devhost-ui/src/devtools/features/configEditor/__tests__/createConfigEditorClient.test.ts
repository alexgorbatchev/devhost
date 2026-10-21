import { describe, expect, mock, test } from "bun:test";

import type { FetchFunction } from "../../../shared/pristineFetch";
import { createConfigEditorClient } from "../createConfigEditorClient";
import type { ConfigSaveResult, IConfigFile } from "../types";

const manifestFile: IConfigFile = {
  content: 'name = "shop"\n',
  kind: "manifest",
  path: "/projects/shop/devhost.toml",
  version: "4f2c",
};

type RefusedSave = [name: string, body: string, status: number, outcome: ConfigSaveResult];

function respondWith(body: string, status: number = 200) {
  return mock<FetchFunction>(async () => new Response(body, { status }));
}

describe("createConfigEditorClient", () => {
  test("lists the editable files", async () => {
    const fetch = respondWith(JSON.stringify({ files: [manifestFile] }));

    expect(await createConfigEditorClient(fetch).listFiles()).toEqual({ files: [manifestFile] });
    expect(fetch.mock.calls).toEqual([["/__devhost__/config/files", { cache: "no-store" }]]);
  });

  test("reads the schema of both kinds of file", async () => {
    const schema = {
      config: { tables: { "": ["caddy"] }, values: {} },
      manifest: { tables: { "": ["name"] }, values: { "devtools.status.position": ["top-right"] } },
    };

    expect(await createConfigEditorClient(respondWith(JSON.stringify(schema))).readSchema()).toEqual({ schema });
  });

  test("checks unsaved content", async () => {
    const fetch = respondWith(JSON.stringify({ issues: [{ keyPath: "name", message: "name Expected a string." }] }));

    expect(await createConfigEditorClient(fetch).check(manifestFile.path, "name = 1\n")).toEqual({
      issues: [{ keyPath: "name", message: "name Expected a string." }],
    });
    expect(fetch.mock.calls).toEqual([
      [
        "/__devhost__/config/validate",
        {
          body: JSON.stringify({ path: manifestFile.path, content: "name = 1\n" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ],
    ]);
  });

  test("saves content over the version it was edited from", async () => {
    const fetch = respondWith(JSON.stringify({ version: "9a1b" }));

    expect(await createConfigEditorClient(fetch).save(manifestFile.path, 'name = "mine"\n', "4f2c")).toEqual({
      kind: "saved",
      version: "9a1b",
    });
    expect(fetch.mock.calls).toEqual([
      [
        "/__devhost__/config/save",
        {
          body: JSON.stringify({ path: manifestFile.path, content: 'name = "mine"\n', baseVersion: "4f2c" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ],
    ]);
  });

  test.each<RefusedSave>([
    ["the file changed on disk", JSON.stringify(manifestFile), 409, { file: manifestFile, kind: "conflict" }],
    [
      "the content fails the checks",
      JSON.stringify({ issues: [{ message: "Dependency cycle detected: api -> api" }] }),
      422,
      { issues: [{ message: "Dependency cycle detected: api -> api" }], kind: "refused" },
    ],
    [
      "devhost refuses the browser",
      "Only a browser on this machine can save the configuration.\n",
      403,
      { kind: "failed", message: "Only a browser on this machine can save the configuration." },
    ],
    [
      "the answer is malformed",
      JSON.stringify({ version: 7 }),
      200,
      { kind: "failed", message: "devhost sent an answer the editor cannot read." },
    ],
  ])("reports a save that does not happen because %s", async (_name, body, status, outcome) => {
    expect(await createConfigEditorClient(respondWith(body, status)).save(manifestFile.path, "", "")).toEqual(outcome);
  });

  test("reports a request that fails", async () => {
    const fetch = mock<FetchFunction>(async () => {
      throw new TypeError("Failed to fetch");
    });

    expect(await createConfigEditorClient(fetch).listFiles()).toEqual({ error: "Failed to fetch" });
    expect(await createConfigEditorClient(respondWith("devhost is still starting the stack", 503)).listFiles()).toEqual(
      {
        error: "devhost is still starting the stack",
      },
    );
  });
});
