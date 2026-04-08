import React, { type JSX } from "react";

import type { IWorkflowStep } from "./types";

export interface IMarketingWorkflowSectionProps {
  manifestPreviewLines: string[];
  workflowSteps: IWorkflowStep[];
}

export function MarketingWorkflowSection(props: IMarketingWorkflowSectionProps): JSX.Element {
  return (
    <section className="workflow-section" aria-labelledby="workflow-section-title">
      <div className="section-intro">
        <p className="panel-kicker">Workflow</p>
        <h2 id="workflow-section-title" className="section-title">
          Give the stack a disciplined path from boot to inspection.
        </h2>
        <p className="section-body">
          This is where devhost earns its keep: boot the edge, resolve the stack, route the host, then keep the
          debugging workflow close enough to the page that context does not leak away.
        </p>
      </div>

      <div className="workflow-layout">
        <div className="workflow-stack">
          {props.workflowSteps.map((workflowStep: IWorkflowStep) => {
            return (
              <article key={workflowStep.step} className="workflow-card">
                <p className="workflow-card__step">{workflowStep.step}</p>
                <div className="workflow-card__content">
                  <h3 className="workflow-card__title">{workflowStep.title}</h3>
                  <p className="workflow-card__body">{workflowStep.body}</p>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="manifest-card" aria-labelledby="manifest-card-title">
          <p className="panel-kicker">Manifest preview</p>
          <h2 id="manifest-card-title" className="section-title">
            The demo app now reads like product evidence.
          </h2>
          <p className="section-body">
            The sample manifest is still the fastest way to explain what devhost owns: stack identity, primary
            routing, devtools placement, editor preference, and service-level process contracts.
          </p>
          <pre className="manifest-preview">
            <code>{props.manifestPreviewLines.join("\n")}</code>
          </pre>
        </aside>
      </div>
    </section>
  );
}
