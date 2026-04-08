import { type JSX } from "react";

import { SectionHeader, Surface, TerminalSnippet } from "../../components/ui";
import { WorkflowStepCard } from "./WorkflowStepCard";

interface IWorkflowStep {
  description: string;
  stepLabel: string;
  title: string;
}

const workflowSteps: readonly IWorkflowStep[] = [
  {
    description: "Start the managed Caddy instance once so devhost can own route registration and local TLS.",
    stepLabel: "01",
    title: "Boot the managed edge",
  },
  {
    description: "Launch one service or a whole manifest and let devhost resolve ports, dependencies, and health checks.",
    stepLabel: "02",
    title: "Run the stack from a manifest",
  },
  {
    description: "Open the routed hostname and inspect the real page with source-aware devtools layered on top.",
    stepLabel: "03",
    title: "Work on the routed host",
  },
  {
    description: "Annotate the page, jump to source, or spawn a terminal session without leaving the browser loop.",
    stepLabel: "04",
    title: "Hand off context without rewriting it",
  },
];

const manifestSnippet: readonly string[] = [
  `name = "hello-test-app"
primaryService = "hello"
devtoolsPosition = "top-right"
devtoolsComponentEditor = "neovim"

[services.hello]
command = ["bun", "dev"]
port = 3200
host = "hello.xcv.lol"

[services.logs.health]
process = true`,
];

export function WorkflowSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="workflow-section-title">
      <SectionHeader
        description="This is where devhost earns its keep: boot the edge, resolve the stack, route the host, then keep the debugging workflow close enough to the page that context does not leak away."
        title="Give the stack a disciplined path from boot to inspection."
        titleId="workflow-section-title"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <div className="grid gap-3">
          {workflowSteps.map((workflowStep: IWorkflowStep) => {
            return (
              <WorkflowStepCard
                key={workflowStep.stepLabel}
                description={workflowStep.description}
                stepLabel={workflowStep.stepLabel}
                title={workflowStep.title}
              />
            );
          })}
        </div>

        <Surface element="aside" className="p-4 sm:p-5" aria-labelledby="manifest-card-title">
          <div className="grid gap-3">
            <h2
              id="manifest-card-title"
              className="max-w-[18ch] text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl"
            >
              The demo app now reads like product evidence.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              The sample manifest is still the fastest way to explain what devhost owns: stack identity, primary
              routing, devtools placement, editor preference, and service-level process contracts.
            </p>
          </div>

          <div className="mt-4">
            <TerminalSnippet snippets={manifestSnippet} />
          </div>
        </Surface>
      </div>
    </section>
  );
}
