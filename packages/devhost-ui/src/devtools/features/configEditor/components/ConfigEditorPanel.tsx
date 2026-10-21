import type { JSX, KeyboardEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { FileCogIcon, SaveIcon, Undo2Icon, XIcon } from "lucide-react";

import { Icon } from "../../../../components/ui/Icon";
import { Button, InlineNotice } from "../../../shared";
import type { IConfigurationStatus } from "../../../shared/types";
import { formatConfigFilePath } from "../formatConfigFilePath";
import { useConfigEditor } from "../hooks/useConfigEditor";
import { readSaveShortcutLabel } from "../readSaveShortcutLabel";
import type { ConfigSaveOutcome, IConfigEditorClient, IConfigEditorView, IConfigFile } from "../types";

interface IConfigEditorPanelProps {
  client: IConfigEditorClient;
  configuration: IConfigurationStatus[];
  homeDirectoryPath: string;
  isOpen: boolean;
  onClose: () => void;
  projectRootPath: string;
}

/**
 * The config editor window. It stays mounted (hidden) while closed, so unsaved changes survive closing it; the TOML
 * editor loads the first time a file is shown.
 */
export function ConfigEditorPanel(props: IConfigEditorPanelProps): JSX.Element {
  const editor = useConfigEditor(props.client, props.isOpen, props.configuration);
  const titleId: string = useId();
  const editorContainerReference = useRef<HTMLDivElement | null>(null);
  const viewReference = useRef<IConfigEditorView | null>(null);
  const editorReference = useRef(editor);
  const [viewError, setViewError] = useState<string | null>(null);
  const { outcome, selectedFile } = editor;
  const hasFile: boolean = selectedFile !== null;
  const isChanged: boolean = selectedFile !== null && editor.changedPaths.includes(selectedFile.path);
  const isSaving: boolean = outcome.kind === "saving";

  editorReference.current = editor;

  useEffect(() => {
    const container: HTMLDivElement | null = editorContainerReference.current;

    if (!hasFile || container === null) {
      return;
    }

    let isDisposed: boolean = false;
    const initializeView = async (): Promise<void> => {
      const { createConfigEditorView } = await import("../createConfigEditorView");
      const rootNode: Node = container.getRootNode();

      if (isDisposed) {
        return;
      }

      viewReference.current = createConfigEditorView({
        check: (content: string) => editorReference.current.check(content),
        content: editorReference.current.content,
        label: "Configuration file",
        onChange: (content: string): void => {
          editorReference.current.change(content);
        },
        onSave: (): void => {
          void editorReference.current.save();
        },
        parent: container,
        readSchema: () => editorReference.current.selectedSchema,
        // In production the editor renders in the devtools shadow root, which must hold its styles.
        root: rootNode instanceof ShadowRoot ? rootNode : container.ownerDocument,
      });
    };

    void initializeView().catch((error: unknown): void => {
      if (!isDisposed) setViewError(error instanceof Error ? error.message : "Failed to load the editor.");
    });

    return () => {
      isDisposed = true;
      viewReference.current?.destroy();
      viewReference.current = null;
    };
  }, [hasFile]);

  useEffect(() => {
    viewReference.current?.setContent(editor.content);
  }, [editor.content]);

  useEffect(() => {
    // The lint panel lists why devhost refused the save.
    if (outcome.kind === "refused") {
      viewReference.current?.recheck();
    }
  }, [outcome]);

  useEffect(() => {
    if (props.isOpen) {
      viewReference.current?.focus();
    }
  }, [props.isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // The TOML editor handles Escape first, as when it closes its completions.
    if (event.key === "Escape" && !event.defaultPrevented) {
      props.onClose();
    }
  };

  return (
    <div className="contents" data-testid="ConfigEditorPanel">
      <div
        aria-hidden="true"
        className="devhost-fade pointer-events-auto fixed inset-0 z-(--devhost-z-modal) bg-backdrop"
        data-testid="ConfigEditorPanel--backdrop"
        hidden={!props.isOpen}
        onClick={props.onClose}
      />
      <section
        aria-labelledby={titleId}
        className="devhost-fade pointer-events-auto fixed top-1/2 left-1/2 z-(--devhost-z-modal) grid h-[min(700px,calc(100vh-32px))] w-[min(960px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_auto_1fr] overflow-hidden rounded-md border border-edge bg-card text-card-foreground shadow-frame"
        data-testid="ConfigEditorPanel--content"
        hidden={!props.isOpen}
        inert={!props.isOpen}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <header
          className="flex h-6.5 min-w-0 items-center gap-1.5 border-b border-border pr-1 pl-2"
          data-testid="ConfigEditorPanel--header"
        >
          <Icon glyph={FileCogIcon} />
          <strong className="shrink-0" id={titleId}>
            Configuration
          </strong>
          <select
            aria-label="File"
            className="h-5 min-w-0 flex-1 rounded-sm border border-input bg-background px-1 text-foreground disabled:opacity-60"
            data-testid="ConfigEditorPanel--file"
            disabled={editor.files.length === 0}
            value={selectedFile?.path ?? ""}
            onChange={(event): void => {
              editor.select(event.target.value);
            }}
          >
            {editor.files.map((file: IConfigFile) => (
              <option key={file.path} value={file.path}>
                {formatConfigFilePath(file.path, props.projectRootPath, props.homeDirectoryPath)}
                {editor.changedPaths.includes(file.path) ? " (unsaved)" : ""}
              </option>
            ))}
          </select>
          <Button
            disabled={!isChanged || isSaving}
            startEnhancer={<Icon glyph={Undo2Icon} />}
            testId="ConfigEditorPanel--revert"
            title="Discard the unsaved changes to this file"
            onClick={editor.revert}
          >
            Revert
          </Button>
          <Button
            disabled={!isChanged || isSaving}
            shortcut={readSaveShortcutLabel(navigator.platform)}
            startEnhancer={<Icon glyph={SaveIcon} />}
            testId="ConfigEditorPanel--save"
            title="Save after devhost checks the file"
            variant="primary"
            onClick={(): void => {
              void editor.save();
            }}
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
          <Button
            startEnhancer={<Icon glyph={XIcon} />}
            testId="ConfigEditorPanel--close"
            title="Close; unsaved changes are kept"
            onClick={props.onClose}
          >
            Close
          </Button>
        </header>
        <ConfigEditorNotice
          loadError={editor.loadError}
          outcome={outcome}
          viewError={viewError}
          onLoadDiskVersion={editor.loadDiskVersion}
        />
        <div
          ref={editorContainerReference}
          className="min-h-0 overflow-hidden"
          data-testid="ConfigEditorPanel--editor"
        />
      </section>
    </div>
  );
}

interface IConfigEditorNoticeProps {
  loadError: string | null;
  outcome: ConfigSaveOutcome;
  viewError: string | null;
  onLoadDiskVersion: () => void;
}

function ConfigEditorNotice(props: IConfigEditorNoticeProps): JSX.Element {
  return <div data-testid="ConfigEditorNotice">{renderNotice(props)}</div>;
}

function renderNotice({
  loadError,
  outcome,
  viewError,
  onLoadDiskVersion,
}: IConfigEditorNoticeProps): JSX.Element | null {
  if (loadError !== null) {
    return (
      <InlineNotice title="The configuration could not be loaded" tone="danger">
        {loadError}
      </InlineNotice>
    );
  }

  if (viewError !== null) {
    return (
      <InlineNotice title="The editor could not start" tone="danger">
        {viewError}
      </InlineNotice>
    );
  }

  switch (outcome.kind) {
    case "applying":
      return <InlineNotice>Saved. devhost is applying the change.</InlineNotice>;
    case "applied":
      return <InlineNotice>Saved and applied.</InlineNotice>;
    case "rejected":
      return (
        <InlineNotice title="devhost kept the previous configuration" tone="danger">
          <span className="whitespace-pre-wrap">{outcome.message}</span>
        </InlineNotice>
      );
    case "conflict":
      return (
        <InlineNotice
          action={<Button onClick={onLoadDiskVersion}>Load from disk</Button>}
          title="The file changed on disk"
          tone="danger"
        >
          It changed since it was opened. Load the version on disk to edit it; the unsaved changes to this file are
          discarded.
        </InlineNotice>
      );
    case "refused":
      return (
        <InlineNotice title="devhost refused the save" tone="danger">
          The file was not written. The issues are listed below the editor.
        </InlineNotice>
      );
    case "failed":
      return (
        <InlineNotice title="The save failed" tone="danger">
          {outcome.message}
        </InlineNotice>
      );
    case "idle":
    case "saving":
      return null;
  }
}
