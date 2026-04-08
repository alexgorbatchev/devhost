import { type JSX } from "react";

export function MarketingWorkflowSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="workflow-section-title">
      <div className="grid gap-3">
        <h2
          id="workflow-section-title"
          className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl"
        >
          Give the stack a disciplined path from boot to inspection.
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">
          This is where devhost earns its keep: boot the edge, resolve the stack, route the host, then keep the
          debugging workflow close enough to the page that context does not leak away.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)]">
        <div className="grid gap-3">
          <article className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5">
            <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
              01
            </p>
            <div className="grid gap-2">
              <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                Boot the managed edge
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                Start the managed Caddy instance once so devhost can own route registration and local TLS.
              </p>
            </div>
          </article>

          <article className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5">
            <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
              02
            </p>
            <div className="grid gap-2">
              <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                Run the stack from a manifest
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                Launch one service or a whole manifest and let devhost resolve ports, dependencies, and health checks.
              </p>
            </div>
          </article>

          <article className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5">
            <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
              03
            </p>
            <div className="grid gap-2">
              <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                Work on the routed host
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                Open the routed hostname and inspect the real page with source-aware devtools layered on top.
              </p>
            </div>
          </article>

          <article className="grid gap-4 rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:p-5">
            <p className="inline-flex h-10 w-fit items-center rounded-md border border-transparent bg-primary px-3 text-sm uppercase tracking-[0.24em] text-primary-foreground shadow-[var(--shadow-soft)]">
              04
            </p>
            <div className="grid gap-2">
              <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                Hand off context without rewriting it
              </h3>
              <p className="text-sm leading-7 text-muted-foreground">
                Annotate the page, jump to source, or spawn a terminal session without leaving the browser loop.
              </p>
            </div>
          </article>
        </div>

        <aside
          className="rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5"
          aria-labelledby="manifest-card-title"
        >
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

          <div className="mt-4 overflow-hidden rounded-lg border border-border-subtle bg-terminal text-terminal-foreground shadow-[var(--shadow-soft)]">
            <pre className="overflow-x-auto px-4 py-4 text-[0.95rem] leading-6 text-terminal-foreground">
              <code>{`name = "hello-test-app"
primaryService = "hello"
devtoolsPosition = "top-right"
devtoolsComponentEditor = "neovim"

[services.hello]
command = ["bun", "dev"]
port = 3200
host = "hello.xcv.lol"

[services.logs.health]
process = true`}</code>
            </pre>
          </div>
        </aside>
      </div>
    </section>
  );
}
