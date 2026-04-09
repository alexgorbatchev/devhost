import { type JSX } from "react";

import { InsetList, SectionHeader, Surface, TerminalSnippet } from "../../components/ui";
import { WorkflowStepCard } from "./WorkflowStepCard";

interface IWorkflowStep {
  description: string;
  stepLabel: string;
  title: string;
}

const workflowSteps: readonly IWorkflowStep[] = [
  {
    description: "Point devhost at the stack by letting it discover devhost.toml or by passing --manifest explicitly.",
    stepLabel: "01",
    title: "Find the stack",
  },
  {
    description:
      "Validate the manifest and resolve ports before child processes start so bad config fails early instead of leaking into the browser.",
    stepLabel: "02",
    title: "Lock the config first",
  },
  {
    description:
      "Claim public hostnames and fixed bind ports before services boot so the edge contract is settled up front.",
    stepLabel: "03",
    title: "Reserve the route",
  },
  {
    description: "Start services in dependency order so the stack comes up like a system, not a race between terminals.",
    stepLabel: "04",
    title: "Boot in the right order",
  },
  {
    description:
      "Wait for health checks, then expose the hostname only when the service is actually ready to receive traffic.",
    stepLabel: "05",
    title: "Go live when healthy",
  },
];

const manifestSnippet: readonly string[] = [
  `name = "hello-stack"

[services.ui]
primary = true
command = ["bun", "run", "ui:dev"]
port = 3000
host = "foo.localhost"
dependsOn = ["api"]

[services.api]
command = ["bun", "run", "api:dev"]
port = 4000
host = "api.foo.localhost"
health = { http = "http://127.0.0.1:4000/healthz" }`,
  `{
  "scripts": {
    "dev": "devhost"
  }
}`,
  "npm run dev\nopen https://foo.localhost",
];

const workflowNotes: readonly string[] = [
  "Mount multiple services under one hostname by giving each service a distinct path.",
  "Front Docker-backed services when they publish a port back onto the host.",
  "Use port = \"auto\" for convenience, but treat it as best-effort rather than a global allocator.",
];

export function WorkflowSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="workflow-section-title" data-testid="WorkflowSection">
      <SectionHeader
        description="devhost turns a messy local boot sequence into a reliable product flow: discover the stack, lock the route, start in order, and make the hostname real only after health passes."
        title="From dev command to real local stack."
        titleId="workflow-section-title"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.92fr)]">
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

        <Surface element="aside" className="grid gap-4 p-4 sm:p-5" aria-labelledby="manifest-card-title">
          <div className="grid gap-3">
            <h2
              id="manifest-card-title"
              className="max-w-[18ch] text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl"
            >
              A small manifest buys a lot.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              A couple of services, one dependency edge, one health check, and suddenly the browser sees a proper local
              entrypoint instead of another pile of ports.
            </p>
          </div>

          <TerminalSnippet snippets={manifestSnippet} />
          <InsetList items={workflowNotes} />
        </Surface>
      </div>
    </section>
  );
}
