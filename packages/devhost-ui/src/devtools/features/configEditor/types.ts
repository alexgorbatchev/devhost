import type { ConfigurationSource } from "../../shared/types";

/** The role an editable file has in the stack's configuration. */
export type ConfigFileKind = "manifest" | "include" | "config";

/** A file the config editor may change, as it is on disk. */
export interface IConfigFile {
  path: string;
  kind: ConfigFileKind;
  content: string;
  /** Identifies the content on disk; empty for a file that does not exist yet. */
  version: string;
}

/** One reason content cannot be applied, with the position or setting it concerns when devhost knows it. */
export interface IConfigIssue {
  message: string;
  /** The file the issue is in, when it is not the file being checked. */
  path?: string;
  line?: number;
  column?: number;
  /** The setting the issue names, such as `services.api.port`. */
  keyPath?: string;
}

/** The settings one kind of file accepts. */
export interface IConfigSchema {
  /** The keys each table accepts, by table path; the root table is `""`, and `*` stands for a chosen name. */
  tables: Record<string, string[]>;
  /** The values a setting accepts, by key path, for settings that take one of a fixed list. */
  values: Record<string, string[]>;
}

/** The settings of the manifest and of the devhost config file. */
export interface IConfigEditorSchema {
  manifest: IConfigSchema;
  config: IConfigSchema;
}

/** What devhost answered to a save. */
export type ConfigSaveResult =
  | { kind: "saved"; version: string }
  | { kind: "conflict"; file: IConfigFile }
  | { kind: "refused"; issues: IConfigIssue[] }
  | { kind: "failed"; message: string };

/** The requests of the config editor. A request that fails answers with its error. */
export interface IConfigEditorClient {
  listFiles: () => Promise<{ files: IConfigFile[] } | { error: string }>;
  readSchema: () => Promise<{ schema: IConfigEditorSchema } | { error: string }>;
  check: (path: string, content: string) => Promise<{ issues: IConfigIssue[] } | { error: string }>;
  save: (path: string, content: string, baseVersion: string) => Promise<ConfigSaveResult>;
}

/** What became of a save. */
export type ConfigSaveOutcome =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "applying"; source: ConfigurationSource; reloadsBeforeSave: number }
  | { kind: "applied" }
  | { kind: "rejected"; message: string }
  | { kind: "conflict"; file: IConfigFile }
  | { kind: "refused"; issues: IConfigIssue[] }
  | { kind: "failed"; message: string };

/** What the TOML editor needs from the panel that shows it. */
export interface IConfigEditorViewOptions {
  parent: HTMLElement;
  /** The shadow root or document the editor mounts its styles into. */
  root: ShadowRoot | Document;
  content: string;
  /** The accessible name of the editable text. */
  label: string;
  /** The schema of the file shown, or null while it is unknown. */
  readSchema: () => IConfigSchema | null;
  /** Checks content as the file shown, and places the issues devhost reports. */
  check: (content: string) => Promise<IConfigDiagnostic[]>;
  onChange: (content: string) => void;
  onSave: () => void;
}

/** The TOML editor of the config editor. */
export interface IConfigEditorView {
  /** Shows content, starting a new undo history unless it is already shown. */
  setContent: (content: string) => void;
  /** Checks the content again, as after an edit. */
  recheck: () => void;
  focus: () => void;
  destroy: () => void;
}

/** A range of text, by its start and end offsets. */
export interface ITextRange {
  from: number;
  to: number;
}

/** An issue placed in the text of the file being edited. */
export interface IConfigDiagnostic extends ITextRange {
  message: string;
}

/** What a completion inserts: a table name, a key, or a value. */
export type ConfigCompletionKind = "table" | "key" | "value";

export interface IConfigCompletion {
  label: string;
  kind: ConfigCompletionKind;
  /** The text the completion inserts in place of the typed word. */
  apply: string;
}

/** The completions for the word that starts at `from`. */
export interface IConfigCompletions {
  from: number;
  options: IConfigCompletion[];
}

/** Text read from a TOML document, and the offset just after it. */
export interface ITomlText {
  value: string;
  end: number;
}

/** A dotted key and the offsets of its first and last segment. */
export interface ITomlKey {
  segments: string[];
  from: number;
  to: number;
}

export type TomlEntryKind = "table" | "arrayTable" | "key";

/** A table header or a key in a TOML document. */
export interface ITomlEntry {
  kind: TomlEntryKind;
  /**
   * The absolute path of the table or key. An element of an array of tables carries its index on its name, as in
   * `["annotation", "actions[0]", "id"]`.
   */
  path: string[];
  /** The line of the entry, starting at 1. */
  line: number;
  /** The offsets of the key, or of the name in a table header. */
  from: number;
  to: number;
}

export interface ITomlScan {
  entries: ITomlEntry[];
  /** Whether the document ends inside a value, such as an array or a multi-line string that is not closed yet. */
  isValueOpen: boolean;
}

/** Where the cursor is in a TOML document, for completion. */
export type TomlCursorContext =
  | { kind: "header"; parentPath: string[]; from: number; text: string }
  | { kind: "key"; tablePath: string[]; parentPath: string[]; from: number; text: string }
  | { kind: "value"; keyPath: string[]; from: number; text: string; isQuoted: boolean }
  | { kind: "none" };
