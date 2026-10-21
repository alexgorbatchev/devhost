import type { Meta, StoryObj } from "@storybook/react";
import { useMemo, useState, type ComponentProps, type JSX } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import { DevtoolsTopLayer } from "@/devtools/shared/components/DevtoolsTopLayer";
import {
  readDevtoolsStoryShadowCanvas,
  renderInDevtoolsStoryShadowRoot,
  StorybookThemeProvider,
} from "@/devtools/shared/components/stories/helpers";
import type { ConfigurationSource, IConfigurationStatus } from "../../../../shared/types";
import { readContrastRatio } from "../../../../../../../../test-support/readContrastRatio";
import type { ConfigSaveResult, IConfigEditorClient } from "../../types";
import { ConfigEditorPanel } from "../ConfigEditorPanel";
import {
  factory_configEditorClient,
  fixture_acceptedConfiguration,
  fixture_includeFile,
  fixture_manifestFile,
  fixture_portIssue,
  fixture_sharedConfigFile,
} from "./fixtures";

type ConfigEditorPanelProps = ComponentProps<typeof ConfigEditorPanel>;

// The devhost a story talks to. The meta's `beforeEach` creates it before the panel renders; a story's own
// `beforeEach` can replace it.
let storyClient: IConfigEditorClient;

const meta: Meta<typeof ConfigEditorPanel> = {
  title: "@alexgorbatchev/devhost-ui/devtools/features/configEditor/components/ConfigEditorPanel",
  component: ConfigEditorPanel,
  args: {
    configuration: fixture_acceptedConfiguration,
    homeDirectoryPath: "/home/alex",
    isOpen: true,
    onClose: fn(),
    projectRootPath: "/home/alex/shop",
  },
  beforeEach: (): void => {
    storyClient = factory_configEditorClient();
  },
  // Typing reaches the editor only in the document: user-event types into the focused element of the document,
  // which is the host of a shadow root rather than the field inside it.
  render: (args, context) => (
    <StorybookThemeProvider globals={context.globals}>
      <DevtoolsTopLayer>
        <ConfigEditorPanelHarness
          {...args}
          client={storyClient}
          reloadError={typeof context.parameters.reloadError === "string" ? context.parameters.reloadError : undefined}
        />
      </DevtoolsTopLayer>
    </StorybookThemeProvider>
  ),
};

export default meta;

type Story = StoryObj<typeof meta>;

interface IConfigEditorPanelHarnessProps extends ConfigEditorPanelProps {
  /** Why devhost rejects the reload that follows a save; the reload is accepted without it. */
  reloadError?: string;
}

// Plays devhost's side of a save: the reload that follows it finishes, and the health stream reports it.
function ConfigEditorPanelHarness({ reloadError, ...props }: IConfigEditorPanelHarnessProps): JSX.Element {
  const [configuration, setConfiguration] = useState<IConfigurationStatus[]>(() => props.configuration);
  const client: IConfigEditorClient = useMemo(
    () => ({
      ...props.client,
      save: async (path: string, content: string, baseVersion: string): Promise<ConfigSaveResult> => {
        const result: ConfigSaveResult = await props.client.save(path, content, baseVersion);
        const source: ConfigurationSource = path === fixture_sharedConfigFile.path ? "config" : "manifest";

        if (result.kind === "saved") {
          setConfiguration((current: IConfigurationStatus[]) =>
            current.map((status: IConfigurationStatus) =>
              status.source === source ? { error: reloadError, reloads: status.reloads + 1, source } : status,
            ),
          );
        }

        return result;
      },
    }),
    [props.client, reloadError],
  );

  return <ConfigEditorPanel {...props} client={client} configuration={configuration} />;
}

async function openPanel(canvas: ReturnType<typeof within>) {
  const dialog: HTMLElement = await canvas.findByRole("dialog", { name: "Configuration" });
  const editor: HTMLElement = await within(dialog).findByRole("textbox", { name: "Configuration file" });

  // The window fades in; it is measured and used once it is opaque.
  await waitFor(() => expect(dialog).toBeVisible());
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
  await waitFor(() => expect(editor).toHaveTextContent('name = "shop"'));

  return { dialog, editor };
}

// Types at the start of the file. A synthetic click carries no coordinates, so the editor places its cursor at the
// position nearest the viewport origin: the start of the text. In user-event keys, "[[" types "[".
async function typeAtStart(editor: HTMLElement, keys: string): Promise<void> {
  await userEvent.click(editor);
  await userEvent.keyboard(keys);
}

async function findCompletions(dialog: HTMLElement): Promise<HTMLElement> {
  return within(dialog).findByRole("listbox", { name: "Completions" });
}

// The list follows each keystroke after a moment, so typing goes on once a finished word has closed it.
async function waitForCompletionsToClose(dialog: HTMLElement): Promise<void> {
  await waitFor(() => expect(within(dialog).queryByRole("listbox", { name: "Completions" })).toBeNull());
}

export const EditsAFile: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));
    const fileSelect: HTMLElement = within(dialog).getByRole("combobox", { name: "File" });
    const saveButton: HTMLElement = within(dialog).getByRole("button", { name: "Save" });

    await expect(
      within(fileSelect)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["devhost.toml", "packages/api/devhost.toml", "~/.config/devhost/config.toml"]);
    await expect(saveButton).toBeDisabled();

    await typeAtStart(editor, "# note{Enter}");
    await waitFor(() =>
      expect(within(fileSelect).getByRole("option", { name: "devhost.toml (unsaved)" })).toBeTruthy(),
    );
    await expect(saveButton).toBeEnabled();

    // Another file shows its own text, and the change stays with the first file.
    await userEvent.selectOptions(fileSelect, fixture_includeFile.path);
    await waitFor(() => expect(editor).toHaveTextContent("port = 4000"));
    await expect(saveButton).toBeDisabled();
    await userEvent.selectOptions(fileSelect, fixture_manifestFile.path);
    await waitFor(() => expect(editor).toHaveTextContent("# note"));

    await userEvent.click(within(dialog).getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(editor).not.toHaveTextContent("# note"));
    await expect(within(fileSelect).getByRole("option", { name: "devhost.toml" })).toBeTruthy();
    await expect(saveButton).toBeDisabled();
  },
};

export const CompletesSettings: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "[[devtools.con");
    await expect(
      within(await findCompletions(dialog))
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["configEditor"]);
    await userEvent.click(within(await findCompletions(dialog)).getByRole("option", { name: "configEditor" }));
    await userEvent.keyboard("]");
    await waitForCompletionsToClose(dialog);
    await userEvent.keyboard("{Enter}ena");
    await userEvent.click(await within(await findCompletions(dialog)).findByRole("option", { name: "enabled" }));
    await userEvent.keyboard(" = true");
    await waitForCompletionsToClose(dialog);
    await userEvent.keyboard("{Enter}[[devtools.status]");
    await waitForCompletionsToClose(dialog);
    // A setting with fixed values offers them as soon as its value starts, quoted.
    await userEvent.keyboard("{Enter}position = ");
    await userEvent.click(await within(await findCompletions(dialog)).findByRole("option", { name: "bottom-right" }));
    await waitFor(() =>
      expect([...editor.querySelectorAll(".cm-line")].slice(0, 4).map((line) => line.textContent)).toEqual([
        "[devtools.configEditor]",
        "enabled = true",
        "[devtools.status]",
        'position = "bottom-right"name = "shop"',
      ]),
    );
  },
};

export const ShowsIssuesWhileTyping: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await userEvent.selectOptions(within(dialog).getByRole("combobox", { name: "File" }), fixture_includeFile.path);
    await waitFor(() => expect(editor).toHaveTextContent("port = 4000"));
    await typeAtStart(editor, "port = 0{Enter}");

    const diagnostics: HTMLElement = await within(dialog).findByRole("listbox", { name: "Diagnostics" });

    await expect(await within(diagnostics).findByText(fixture_portIssue.message)).toBeVisible();
    await waitFor(() =>
      expect(storyClient.check).toHaveBeenLastCalledWith(
        fixture_includeFile.path,
        `port = 0\n${fixture_includeFile.content}`,
      ),
    );
  },
};

export const SavesAndApplies: Story = {
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "# saved{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await expect(await within(dialog).findByText("Saved and applied.")).toBeVisible();
    await expect(storyClient.save).toHaveBeenCalledWith(
      fixture_manifestFile.path,
      `# saved\n${fixture_manifestFile.content}`,
      fixture_manifestFile.version,
    );
    await expect(within(dialog).getByRole("option", { name: "devhost.toml" })).toBeTruthy();
    await expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

export const ReloadRejectsTheSave: Story = {
  parameters: { reloadError: 'Manifest schema is invalid:\nservices.api Unrecognized key: "prot"' },
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "# saved{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const notice: HTMLElement = await within(dialog).findByRole("alert");

    await expect(notice).toHaveTextContent("devhost kept the previous configuration");
    await expect(notice).toHaveTextContent('services.api Unrecognized key: "prot"');
  },
};

export const ConflictsWithTheFileOnDisk: Story = {
  beforeEach: (): void => {
    const diskFile = { ...fixture_manifestFile, content: 'name = "theirs"\n', version: "manifest-2" };

    storyClient = {
      ...factory_configEditorClient(),
      save: fn(async () => ({ file: diskFile, kind: "conflict" as const })),
    };
  },
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "# mine{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    const notice: HTMLElement = await within(dialog).findByRole("alert");

    await expect(notice).toHaveTextContent("The file changed on disk");
    await userEvent.click(within(notice).getByRole("button", { name: "Load from disk" }));
    await waitFor(() => expect(editor).toHaveTextContent('name = "theirs"'));
    await expect(editor).not.toHaveTextContent("# mine");
    await expect(within(dialog).queryByRole("alert")).toBeNull();
    await expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  },
};

export const RefusesInvalidContent: Story = {
  beforeEach: (): void => {
    storyClient = {
      ...factory_configEditorClient(),
      save: fn(async () => ({ issues: [fixture_portIssue], kind: "refused" as const })),
    };
  },
  play: async ({ canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "# refused{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "devhost refused the saveThe file was not written. The issues are listed below the editor.",
    );
    await expect(within(dialog).getByRole("option", { name: "devhost.toml (unsaved)" })).toBeTruthy();
  },
};

export const CannotLoadTheFiles: Story = {
  beforeEach: (): void => {
    storyClient = {
      ...factory_configEditorClient(),
      listFiles: fn(async () => ({ error: "devhost is still starting the stack" })),
    };
  },
  play: async ({ canvasElement }): Promise<void> => {
    const dialog: HTMLElement = await within(canvasElement).findByRole("dialog", { name: "Configuration" });

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The configuration could not be loadeddevhost is still starting the stack",
    );
    await expect(within(dialog).getByRole("combobox", { name: "File" })).toBeDisabled();
    await expect(within(dialog).queryByRole("textbox", { name: "Configuration file" })).toBeNull();
  },
};

export const ClosesWithoutLosingChanges: Story = {
  play: async ({ args, canvasElement }): Promise<void> => {
    const { dialog, editor } = await openPanel(within(canvasElement));

    await typeAtStart(editor, "# kept{Enter}");
    // Escape right after typing cancels the editor's pending completions; from the rest of the window it closes it.
    await userEvent.click(within(dialog).getByRole("combobox", { name: "File" }));
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await expect(args.onClose).toHaveBeenCalledTimes(2);
    await expect(within(dialog).getByRole("option", { name: "devhost.toml (unsaved)" })).toBeTruthy();
  },
};

export const Closed: Story = {
  args: { isOpen: false },
  play: async ({ canvasElement }): Promise<void> => {
    await expect(within(canvasElement).queryByRole("dialog", { name: "Configuration" })).toBeNull();
    await expect(storyClient.listFiles).not.toHaveBeenCalled();
  },
};

const readableSyntaxPlay: Story["play"] = async ({ canvasElement }): Promise<void> => {
  const { editor } = await openPanel(await readDevtoolsStoryShadowCanvas(canvasElement));

  // A table header, a key, and a string on a line the cursor is not on, and the first line under the cursor.
  for (const text of ["[devtools.status]", "position", '"top-right"', '"shop"']) {
    await expect(readContrastRatio(within(editor).getByText(text))).toBeGreaterThanOrEqual(4.5);
  }
};

// In the devtools shadow root, as in production, the editor's styles mount into that root.
const renderInShadowRoot: Story["render"] = (args, context) =>
  renderInDevtoolsStoryShadowRoot(
    <StorybookThemeProvider globals={context.globals}>
      <ConfigEditorPanelHarness {...args} client={storyClient} />
    </StorybookThemeProvider>,
  );

export const ReadableSyntaxDark: Story = {
  globals: { devhostTheme: "dark" },
  play: readableSyntaxPlay,
  render: renderInShadowRoot,
};

export const ReadableSyntaxLight: Story = {
  globals: { devhostTheme: "light" },
  play: readableSyntaxPlay,
  render: renderInShadowRoot,
};
