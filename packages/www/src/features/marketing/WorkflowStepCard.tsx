import { type JSX } from "react";

import { Surface } from "../../components/ui";

export interface IWorkflowStepCardProps {
  description: string;
  stepLabel: string;
  title: string;
}

export function WorkflowStepCard(props: IWorkflowStepCardProps): JSX.Element {
  return (
    <Surface element="article" className="grid gap-4 p-4 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5">
      <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
        {props.stepLabel}
      </p>
      <div className="grid gap-2">
        <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">{props.title}</h3>
        <p className="text-sm leading-7 text-muted-foreground">{props.description}</p>
      </div>
    </Surface>
  );
}
