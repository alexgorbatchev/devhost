import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { forceLinting, linter, lintGutter, lintKeymap, type Diagnostic } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { CONFIG_CHECK_DELAY_MS } from "./constants";
import { readConfigCompletions } from "./readConfigCompletions";
import { readTomlCursorContext } from "./readTomlCursorContext";
import type {
  ConfigCompletionKind,
  IConfigCompletions,
  IConfigDiagnostic,
  IConfigEditorView,
  IConfigEditorViewOptions,
} from "./types";

const completionTypes: Record<ConfigCompletionKind, string> = { key: "property", table: "namespace", value: "enum" };
const typedWordPattern = /^[\w-]*$/;

// Every color comes from the devtools theme variables, so the editor follows the light and dark schemes.
const configEditorTheme: Extension = EditorView.theme({
  "&": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
    fontSize: "var(--ag-text)",
    height: "100%",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "var(--accent)" },
  ".cm-activeLine": { backgroundColor: "var(--muted)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--accent)", color: "var(--foreground)" },
  ".cm-content": { caretColor: "var(--primary)", fontFamily: "var(--font-mono)" },
  ".cm-gutters": {
    backgroundColor: "var(--muted)",
    borderRight: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--destructive)" },
  ".cm-panels": { backgroundColor: "var(--card)", color: "var(--card-foreground)" },
  ".cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-panel-lint ul [aria-selected]": { backgroundColor: "var(--accent)" },
  ".cm-diagnostic": { fontFamily: "var(--font-mono)" },
  ".cm-diagnostic-error": { borderLeftColor: "var(--destructive)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)" },
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    border: "1px solid var(--border)",
    color: "var(--popover-foreground)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
});

const configHighlightStyle: HighlightStyle = HighlightStyle.define([
  { color: "var(--primary)", fontWeight: "bold", tag: tags.atom },
  { color: "var(--muted-foreground)", fontStyle: "italic", tag: tags.comment },
  { color: "var(--warning)", tag: tags.number },
  { color: "var(--foreground)", tag: tags.propertyName },
  { color: "var(--success)", tag: tags.string },
  { color: "var(--muted-foreground)", tag: tags.bracket },
]);

const tomlLanguage = StreamLanguage.define(toml);

/**
 * Builds the TOML editor of the config editor inside a shadow root. devhost checks the content after each pause in
 * typing, and the lint panel lists every issue it reports.
 */
export function createConfigEditorView(options: IConfigEditorViewOptions): IConfigEditorView {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    drawSelection(),
    history(),
    bracketMatching(),
    tomlLanguage,
    syntaxHighlighting(configHighlightStyle),
    autocompletion({ override: [(context: CompletionContext) => readCompletionResult(options, context)] }),
    linter(
      async (view: EditorView): Promise<Diagnostic[]> => {
        const diagnostics: IConfigDiagnostic[] = await options.check(view.state.doc.toString());

        return diagnostics.map((diagnostic: IConfigDiagnostic): Diagnostic => ({ ...diagnostic, severity: "error" }));
      },
      { autoPanel: true, delay: CONFIG_CHECK_DELAY_MS },
    ),
    lintGutter(),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: (): boolean => {
          options.onSave();
          return true;
        },
      },
      indentWithTab,
      ...lintKeymap,
      ...historyKeymap,
      ...defaultKeymap,
    ]),
    EditorView.contentAttributes.of({ "aria-label": options.label }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        options.onChange(update.state.doc.toString());
      }
    }),
    configEditorTheme,
  ];
  const view = new EditorView({
    parent: options.parent,
    root: options.root,
    state: EditorState.create({ doc: options.content, extensions }),
  });

  return {
    destroy: (): void => {
      view.destroy();
    },
    focus: (): void => {
      view.focus();
    },
    recheck: (): void => {
      forceLinting(view);
    },
    // A new file starts a new state, so undo never reaches into the file shown before.
    setContent: (content: string): void => {
      if (view.state.doc.toString() !== content) {
        view.setState(EditorState.create({ doc: content, extensions }));
      }
    },
  };
}

function readCompletionResult(options: IConfigEditorViewOptions, context: CompletionContext) {
  const schema = options.readSchema();

  if (schema === null) {
    return null;
  }

  const completions: IConfigCompletions | null = readConfigCompletions(
    schema,
    readTomlCursorContext(context.state.doc.toString(), context.pos),
  );

  // Keys and tables offer completions for an empty word only when asked, so typing a new line opens nothing; a value
  // offers its choices as soon as it starts.
  const isValue: boolean = completions?.options.some((option) => option.kind === "value") === true;

  if (completions === null || (completions.from === context.pos && !context.explicit && !isValue)) {
    return null;
  }

  return {
    from: completions.from,
    options: completions.options.map(
      (option): Completion => ({ apply: option.apply, label: option.label, type: completionTypes[option.kind] }),
    ),
    validFor: typedWordPattern,
  };
}
