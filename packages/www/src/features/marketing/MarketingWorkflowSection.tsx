import React, { type JSX } from "react";

import type { IWorkflowStep } from "./types";

export interface IMarketingWorkflowSectionProps {
  manifestPreviewLines: string[];
  workflowSteps: IWorkflowStep[];
}

export function MarketingWorkflowSection(props: IMarketingWorkflowSectionProps): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="workflow-section-title">
      <div className="grid gap-3">
        <h2 id="workflow-section-title" className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl">
          Give the stack a disciplined path from boot to inspection.
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">
          This is where devhost earns its keep: boot the edge, resolve the stack, route the host, then keep the
          debugging workflow close enough to the page that context does not leak away.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <div className="grid gap-3">
          {props.workflowSteps.map((workflowStep: IWorkflowStep) => {
            return (
              <article
                key={workflowStep.step}
                className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5"
              >
                <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
                  {workflowStep.step}
                </p>
                <div className="grid gap-2">
                  <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                    {workflowStep.title}
                  </h3>
                  <p className="text-sm leading-7 text-muted-foreground">{workflowStep.body}</p>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5" aria-labelledby="manifest-card-title">
          <div className="grid gap-3">
            <h2 id="manifest-card-title" className="max-w-[18ch] text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
              The demo app now reads like product evidence.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              The sample manifest is still the fastest way to explain what devhost owns: stack identity, primary
              routing, devtools placement, editor preference, and service-level process contracts.
            </p>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle bg-terminal text-terminal-foreground shadow-[var(--shadow-soft)]">
            <pre className="overflow-x-auto px-4 py-4 text-[0.95rem] leading-6 text-terminal-foreground">
              <code>{props.manifestPreviewLines.join("\n")}</code>
            </pre>
          </div>
        </aside>
      </div>
    </section>
  );
}
