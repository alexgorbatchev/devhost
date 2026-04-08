import { type JSX } from "react";

export interface IInsetListProps {
  items: readonly string[];
}

export function InsetList(props: IInsetListProps): JSX.Element {
  return (
    <ul className="grid gap-2">
      {props.items.map((item: string, index: number) => {
        return (
          <li
            key={`${index}-${item}`}
            className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground"
          >
            {item}
          </li>
        );
      })}
    </ul>
  );
}
