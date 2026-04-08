import { Fragment, type JSX } from "react";

export interface ITerminalSnippetProps {
  snippets: readonly string[];
}

export function TerminalSnippet(props: ITerminalSnippetProps): JSX.Element {
  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle bg-terminal text-terminal-foreground shadow-[var(--shadow-soft)]">
      {props.snippets.map((snippet: string, index: number) => {
        const hasDivider: boolean = index < props.snippets.length - 1;
        const preClassName = [
          "overflow-x-auto px-4 py-4 text-[0.95rem] leading-6 text-terminal-foreground",
          hasDivider ? "border-b border-border" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <Fragment key={`${index}-${snippet}`}>
            <pre className={preClassName}>
              <code>{snippet}</code>
            </pre>
          </Fragment>
        );
      })}
    </div>
  );
}
