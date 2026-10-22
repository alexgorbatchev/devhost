import { useCallback, useEffect, useRef, useState } from "react";

import type { ConfigurationSource, IConfigurationStatus } from "../../../shared/types";
import { readConfigDiagnostics } from "../readConfigDiagnostics";
import type {
  ConfigSaveOutcome,
  ConfigSaveResult,
  IConfigDiagnostic,
  IConfigEditorClient,
  IConfigEditorSchema,
  IConfigFile,
  IConfigSchema,
} from "../types";

interface IUseConfigEditorResult {
  files: IConfigFile[];
  /** Why the files could not be loaded. */
  loadError: string | null;
  selectedFile: IConfigFile | null;
  /** The schema of the selected file, or null until it is loaded. */
  selectedSchema: IConfigSchema | null;
  /**
   * The text of the selected file, with its unsaved changes, as of now: the editor reports typing ahead of the page,
   * so this includes changes the page has not rendered yet.
   */
  readContent: () => string;
  /**
   * Counts the times the selected file's text was replaced by anything but typing in the editor: loading the files,
   * selecting a file, reverting, or loading the version on disk. The editor takes the text again only when it changes.
   */
  textReplacements: number;
  /** The files with unsaved changes. */
  changedPaths: string[];
  outcome: ConfigSaveOutcome;
  select: (path: string) => void;
  change: (content: string) => void;
  revert: () => void;
  save: () => Promise<void>;
  /** Replaces the selected file's text with the one on disk after a conflicting save. */
  loadDiskVersion: () => void;
  /** Checks content as the selected file and places the issues devhost reports. */
  check: (content: string) => Promise<IConfigDiagnostic[]>;
}

const idleOutcome: ConfigSaveOutcome = { kind: "idle" };

/**
 * The state of the config editor. Files load each time the editor opens; a file with unsaved changes keeps the
 * version it was opened at, so saving it after the file changed on disk is refused. After a save, the outcome waits
 * for the reload that follows it.
 */
export function useConfigEditor(
  client: IConfigEditorClient,
  isOpen: boolean,
  configuration: IConfigurationStatus[],
): IUseConfigEditorResult {
  const [files, setFiles] = useState<IConfigFile[]>([]);
  const [schema, setSchema] = useState<IConfigEditorSchema | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<ConfigSaveOutcome>(idleOutcome);
  const [textReplacements, setTextReplacements] = useState<number>(0);
  const selectedFile: IConfigFile | null =
    files.find((file: IConfigFile): boolean => file.path === selectedPath) ?? files.at(0) ?? null;
  const changedPaths: string[] = files
    .filter((file: IConfigFile): boolean => drafts[file.path] !== undefined && drafts[file.path] !== file.content)
    .map((file: IConfigFile): string => file.path);
  const selectedFileReference = useRef<IConfigFile | null>(selectedFile);
  const configurationReference = useRef<IConfigurationStatus[]>(configuration);
  const draftsReference = useRef<Record<string, string>>(drafts);

  selectedFileReference.current = selectedFile;
  configurationReference.current = configuration;
  draftsReference.current = drafts;

  // A save can follow an edit before the page renders it, so every change to the drafts reaches the reference at once.
  const replaceDrafts = useCallback((nextDrafts: Record<string, string>): void => {
    draftsReference.current = nextDrafts;
    setDrafts(nextDrafts);
  }, []);

  const countTextReplacement = useCallback((): void => {
    setTextReplacements((count: number): number => count + 1);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let isCurrent: boolean = true;

    void Promise.all([client.listFiles(), client.readSchema()]).then(([fileList, schemaAnswer]) => {
      if (!isCurrent) {
        return;
      }

      if ("error" in fileList) {
        setLoadError(fileList.error);
        return;
      }

      setLoadError("error" in schemaAnswer ? schemaAnswer.error : null);
      setSchema("error" in schemaAnswer ? null : schemaAnswer.schema);
      setFiles((currentFiles: IConfigFile[]): IConfigFile[] => {
        return keepChangedFiles(fileList.files, currentFiles, draftsReference.current);
      });
      countTextReplacement();
    });

    return () => {
      isCurrent = false;
    };
  }, [client, countTextReplacement, isOpen]);

  useEffect(() => {
    if (outcome.kind !== "applying") {
      return;
    }

    const status: IConfigurationStatus | undefined = configuration.find(
      (current: IConfigurationStatus): boolean => current.source === outcome.source,
    );

    if (status === undefined || status.reloads <= outcome.reloadsBeforeSave) {
      return;
    }

    setOutcome(status.error === undefined ? { kind: "applied" } : { kind: "rejected", message: status.error });
  }, [configuration, outcome]);

  const select = useCallback(
    (path: string): void => {
      setSelectedPath(path);
      setOutcome(idleOutcome);
      countTextReplacement();
    },
    [countTextReplacement],
  );

  const readContent = useCallback((): string => {
    return readFileContent(selectedFileReference.current, draftsReference.current);
  }, []);

  const change = useCallback(
    (nextContent: string): void => {
      const file: IConfigFile | null = selectedFileReference.current;

      if (file !== null) {
        replaceDrafts({ ...draftsReference.current, [file.path]: nextContent });
      }
    },
    [replaceDrafts],
  );

  const revert = useCallback((): void => {
    const file: IConfigFile | null = selectedFileReference.current;

    if (file !== null) {
      replaceDrafts(withoutKey(draftsReference.current, file.path));
      countTextReplacement();
    }
  }, [countTextReplacement, replaceDrafts]);

  const save = useCallback(async (): Promise<void> => {
    const file: IConfigFile | null = selectedFileReference.current;

    if (file === null) {
      return;
    }

    const savedContent: string = draftsReference.current[file.path] ?? file.content;

    // The save shortcut works while the Save button is disabled; neither writes a file without unsaved changes.
    if (savedContent === file.content) {
      return;
    }
    const source: ConfigurationSource = file.kind === "config" ? "config" : "manifest";
    // The reload a save starts can finish before devhost answers the save.
    const reloadsBeforeSave: number = readReloads(configurationReference.current, source);

    setOutcome({ kind: "saving" });

    const result: ConfigSaveResult = await client.save(file.path, savedContent, file.version);

    if (result.kind !== "saved") {
      setOutcome(result);
      return;
    }

    setFiles((current: IConfigFile[]) =>
      current.map((entry: IConfigFile): IConfigFile => {
        return entry.path === file.path ? { ...entry, content: savedContent, version: result.version } : entry;
      }),
    );
    setOutcome({ kind: "applying", reloadsBeforeSave, source });
  }, [client]);

  const loadDiskVersion = useCallback((): void => {
    if (outcome.kind !== "conflict") {
      return;
    }

    const diskFile: IConfigFile = outcome.file;

    setFiles((current: IConfigFile[]) =>
      current.map((entry: IConfigFile): IConfigFile => (entry.path === diskFile.path ? diskFile : entry)),
    );
    replaceDrafts(withoutKey(draftsReference.current, diskFile.path));
    setOutcome(idleOutcome);
    countTextReplacement();
  }, [countTextReplacement, outcome, replaceDrafts]);

  const check = useCallback(
    async (checkedContent: string): Promise<IConfigDiagnostic[]> => {
      const file: IConfigFile | null = selectedFileReference.current;

      if (file === null) {
        return [];
      }

      const answer = await client.check(file.path, checkedContent);

      return "error" in answer
        ? [{ from: 0, message: answer.error, to: 0 }]
        : readConfigDiagnostics(answer.issues, checkedContent, file.path);
    },
    [client],
  );

  return {
    change,
    changedPaths,
    check,
    files,
    loadDiskVersion,
    loadError,
    outcome,
    readContent,
    revert,
    save,
    select,
    selectedFile,
    selectedSchema: schema === null || selectedFile === null ? null : selectSchema(schema, selectedFile),
    textReplacements,
  };
}

function readFileContent(file: IConfigFile | null, drafts: Record<string, string>): string {
  return file === null ? "" : (drafts[file.path] ?? file.content);
}

// A file with unsaved changes keeps the version it was opened at, which the changes are based on.
function keepChangedFiles(
  loadedFiles: IConfigFile[],
  openedFiles: IConfigFile[],
  drafts: Record<string, string>,
): IConfigFile[] {
  return loadedFiles.map((loaded: IConfigFile): IConfigFile => {
    const opened: IConfigFile | undefined = openedFiles.find((file: IConfigFile): boolean => file.path === loaded.path);
    const draft: string | undefined = drafts[loaded.path];

    return opened !== undefined && draft !== undefined && draft !== opened.content ? opened : loaded;
  });
}

function selectSchema(schema: IConfigEditorSchema, file: IConfigFile): IConfigSchema {
  return file.kind === "config" ? schema.config : schema.manifest;
}

function readReloads(configuration: IConfigurationStatus[], source: ConfigurationSource): number {
  return configuration.find((status: IConfigurationStatus): boolean => status.source === source)?.reloads ?? 0;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const { [key]: _removed, ...rest } = record;

  return rest;
}
