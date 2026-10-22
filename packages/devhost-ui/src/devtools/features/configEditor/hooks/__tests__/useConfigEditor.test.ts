import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { IConfigurationStatus } from "../../../../shared/types";
import type { ConfigSaveResult, IConfigEditorClient, IConfigEditorSchema, IConfigFile } from "../../types";
import { useConfigEditor } from "../useConfigEditor";

interface IHookProps {
  configuration: IConfigurationStatus[];
  isOpen: boolean;
}

const manifestFile: IConfigFile = {
  content: 'name = "shop"\n',
  kind: "manifest",
  path: "/projects/shop/devhost.toml",
  version: "v1",
};
const configFile: IConfigFile = {
  content: "",
  kind: "config",
  path: "/home/alex/.config/devhost/config.toml",
  version: "",
};
const schema: IConfigEditorSchema = {
  config: { tables: { "": ["caddy"] }, values: {} },
  manifest: { tables: { "": ["name", "services"] }, values: {} },
};

function createClient(files: IConfigFile[] = [manifestFile, configFile]) {
  return {
    check: vi.fn<IConfigEditorClient["check"]>(async () => ({ issues: [] })),
    listFiles: vi.fn<IConfigEditorClient["listFiles"]>(async () => ({ files })),
    readSchema: vi.fn<IConfigEditorClient["readSchema"]>(async () => ({ schema })),
    save: vi.fn<IConfigEditorClient["save"]>(async (): Promise<ConfigSaveResult> => ({ kind: "saved", version: "v2" })),
  };
}

async function openEditor(client: IConfigEditorClient, configuration: IConfigurationStatus[] = []) {
  const hook = renderHook((props: IHookProps) => useConfigEditor(client, props.isOpen, props.configuration), {
    initialProps: { configuration, isOpen: true },
  });

  await act(async (): Promise<void> => {});

  return hook;
}

describe("useConfigEditor", () => {
  test("loads the files and the schema when it opens, showing the manifest", async () => {
    const client = createClient();
    const { result } = await openEditor(client);

    expect(result.current.files).toEqual([manifestFile, configFile]);
    expect(result.current.selectedFile).toEqual(manifestFile);
    expect(result.current.readContent()).toBe('name = "shop"\n');
    expect(result.current.selectedSchema).toEqual(schema.manifest);
    expect(result.current.loadError).toBeNull();

    act(() => result.current.select(configFile.path));
    expect(result.current.selectedSchema).toEqual(schema.config);
  });

  test("waits until it opens to load anything", async () => {
    const client = createClient();
    const hook = renderHook((props: IHookProps) => useConfigEditor(client, props.isOpen, props.configuration), {
      initialProps: { configuration: [], isOpen: false },
    });

    await act(async (): Promise<void> => {});
    expect(client.listFiles).not.toHaveBeenCalled();

    hook.rerender({ configuration: [], isOpen: true });
    await act(async (): Promise<void> => {});
    expect(hook.result.current.files).toEqual([manifestFile, configFile]);
  });

  test("keeps unsaved changes per file until they are reverted", async () => {
    const { result } = await openEditor(createClient());

    act(() => result.current.change('name = "mine"\n'));
    act(() => result.current.select(configFile.path));
    expect(result.current.readContent()).toBe("");
    act(() => result.current.select(manifestFile.path));
    expect(result.current.readContent()).toBe('name = "mine"\n');
    expect(result.current.changedPaths).toEqual([manifestFile.path]);

    act(() => result.current.revert());
    expect(result.current.readContent()).toBe('name = "shop"\n');
    expect(result.current.changedPaths).toEqual([]);
  });

  test("saves over the version it opened and reports the reload that follows", async () => {
    const client = createClient();
    const accepted: IConfigurationStatus = { reloads: 4, source: "manifest" };
    const hook = await openEditor(client, [accepted]);

    act(() => hook.result.current.change('name = "mine"\n'));
    await act(async () => hook.result.current.save());
    expect(client.save.mock.calls).toEqual([[manifestFile.path, 'name = "mine"\n', "v1"]]);
    expect(hook.result.current.outcome).toEqual({ kind: "applying", reloadsBeforeSave: 4, source: "manifest" });
    expect(hook.result.current.changedPaths).toEqual([]);
    expect(hook.result.current.selectedFile?.version).toBe("v2");

    // Another source finishing a reload says nothing about this save.
    hook.rerender({ configuration: [accepted, { reloads: 9, source: "config" }], isOpen: true });
    expect(hook.result.current.outcome.kind).toBe("applying");

    hook.rerender({ configuration: [{ reloads: 5, source: "manifest" }], isOpen: true });
    expect(hook.result.current.outcome).toEqual({ kind: "applied" });
  });

  test("saves the latest edit when the save follows it before the page renders again", async () => {
    const client = createClient();
    const { result } = await openEditor(client);

    // The save shortcut can arrive right after the keystroke that changed the text.
    await act(async () => {
      result.current.change('name = "mine"\n');
      await result.current.save();
    });

    expect(client.save.mock.calls).toEqual([[manifestFile.path, 'name = "mine"\n', "v1"]]);
  });

  test("does not save a file without unsaved changes, as the disabled Save button does not", async () => {
    const client = createClient();
    const { result } = await openEditor(client);

    await act(async () => result.current.save());
    act(() => result.current.change(manifestFile.content));
    await act(async () => result.current.save());

    expect(client.save).not.toHaveBeenCalled();
    expect(result.current.outcome).toEqual({ kind: "idle" });
  });

  test("reports a reload that rejects the saved file", async () => {
    const { result, rerender } = await openEditor(createClient(), [{ reloads: 1, source: "manifest" }]);

    act(() => result.current.change("name = 1\n"));
    await act(async () => result.current.save());
    rerender({
      configuration: [{ error: "Failed to parse devhost.toml", reloads: 2, source: "manifest" }],
      isOpen: true,
    });
    expect(result.current.outcome).toEqual({ kind: "rejected", message: "Failed to parse devhost.toml" });
  });

  // The editor holds the text being typed, so the hook marks only the replacements that come from elsewhere.
  test("counts the text replacements that do not come from typing", async () => {
    const client = createClient();
    const diskFile: IConfigFile = { ...manifestFile, content: 'name = "theirs"\n', version: "v3" };

    client.save.mockResolvedValueOnce({ file: diskFile, kind: "conflict" });

    const hook = await openEditor(client);
    const replacementsAfterLoad: number = hook.result.current.textReplacements;
    const expectReplacements = (count: number): void => {
      expect(hook.result.current.textReplacements).toBe(replacementsAfterLoad + count);
    };

    expect(replacementsAfterLoad).toBeGreaterThan(0);
    act(() => hook.result.current.change('name = "mine"\n'));
    expectReplacements(0);
    act(() => hook.result.current.select(configFile.path));
    expectReplacements(1);
    act(() => hook.result.current.select(manifestFile.path));
    expectReplacements(2);
    act(() => hook.result.current.revert());
    expectReplacements(3);

    act(() => hook.result.current.change('name = "mine"\n'));
    await act(async () => hook.result.current.save());
    expectReplacements(3);
    act(() => hook.result.current.loadDiskVersion());
    expectReplacements(4);

    hook.rerender({ configuration: [], isOpen: false });
    hook.rerender({ configuration: [], isOpen: true });
    await act(async (): Promise<void> => {});
    expectReplacements(5);
  });

  test("offers the file on disk after a save that conflicts with it", async () => {
    const client = createClient();
    const diskFile: IConfigFile = { ...manifestFile, content: 'name = "theirs"\n', version: "v3" };

    client.save.mockResolvedValueOnce({ file: diskFile, kind: "conflict" });

    const { result } = await openEditor(client);

    act(() => result.current.change('name = "mine"\n'));
    await act(async () => result.current.save());
    expect(result.current.outcome).toEqual({ file: diskFile, kind: "conflict" });

    act(() => result.current.loadDiskVersion());
    expect(result.current.readContent()).toBe('name = "theirs"\n');
    expect(result.current.selectedFile?.version).toBe("v3");
    expect(result.current.outcome).toEqual({ kind: "idle" });
  });

  test("reloads unchanged files when it opens again, keeping a changed file at its opened version", async () => {
    const client = createClient();
    const hook = await openEditor(client);
    const configOnDisk: IConfigFile = { ...configFile, content: "[caddy]\n", version: "c1" };

    act(() => hook.result.current.change('name = "mine"\n'));
    client.listFiles.mockResolvedValueOnce({ files: [{ ...manifestFile, version: "v9" }, configOnDisk] });
    hook.rerender({ configuration: [], isOpen: false });
    hook.rerender({ configuration: [], isOpen: true });
    await act(async (): Promise<void> => {});

    expect(hook.result.current.files).toEqual([manifestFile, configOnDisk]);
    expect(hook.result.current.readContent()).toBe('name = "mine"\n');
  });

  test("checks content as the selected file and places the issues", async () => {
    const client = createClient();

    client.check.mockResolvedValueOnce({ issues: [{ keyPath: "name", message: "name Expected a string." }] });

    const { result } = await openEditor(client);
    const diagnostics = await result.current.check("name = 1\n");

    expect(client.check.mock.calls).toEqual([[manifestFile.path, "name = 1\n"]]);
    expect(diagnostics).toEqual([{ from: 0, message: "name Expected a string.", to: 4 }]);
  });

  test("reports files that cannot be loaded", async () => {
    const client = createClient();

    client.listFiles.mockResolvedValueOnce({ error: "devhost is still starting the stack" });

    const { result } = await openEditor(client);

    expect(result.current.loadError).toBe("devhost is still starting the stack");
    expect(result.current.selectedFile).toBeNull();
  });
});
