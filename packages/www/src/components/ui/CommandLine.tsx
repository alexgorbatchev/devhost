import { Fragment, type JSX } from "react";

export interface ICommandLineProps {
  /**
   * The command string, can be multi-line.
   * Lines will automatically receive a `$` prefix.
   */
  command: string;
}

export function CommandLine(props: ICommandLineProps): JSX.Element {
  const lines = props.command.split("\n").map((line: string) => {
    // Strip existing "$ " prefix so we don't double up
    return line.replace(/^\$\s+/, "");
  });

  return (
    <pre data-testid="CommandLine">
      <code className="language-bash">
        {lines.map((line: string, index: number) => (
          <Fragment key={index}>
            <span className="select-none opacity-50">$ </span>
            {line}
            {index < lines.length - 1 && "\n"}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}
