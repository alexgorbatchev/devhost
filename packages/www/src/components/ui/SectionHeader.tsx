import { type JSX } from "react";

export interface ISectionHeaderProps {
  description?: string;
  title: string;
  titleId: string;
}

export function SectionHeader(props: ISectionHeaderProps): JSX.Element {
  return (
    <div className="grid gap-3" data-testid="SectionHeader">
      <h2
        id={props.titleId}
        className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl"
      >
        {props.title}
      </h2>
      {props.description ? <p className="text-sm leading-7 text-muted-foreground">{props.description}</p> : null}
    </div>
  );
}
