import React, { type JSX } from "react";

export interface IMarketingHeroSectionProps {
  launchCommands: string[];
}

export function MarketingHeroSection(props: IMarketingHeroSectionProps): JSX.Element {
  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.95fr)]" aria-labelledby="hero-title">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="grid gap-6">
          <div className="grid gap-4">
            <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
              Managed local stacks behind real hosts
            </p>
            <h1 id="hero-title" className="max-w-[14ch] text-balance text-5xl font-medium leading-none tracking-[-0.09em] text-card-foreground sm:text-6xl lg:text-7xl">
              devhost is the storefront for routed local stacks.
            </h1>
            <p className="max-w-[68ch] text-[1rem] leading-7 text-muted-foreground">
              Start the app, wait for health, route a real hostname through managed Caddy, and layer source-aware
              devtools on top without dragging every asset request through the proxy.
            </p>
          </div>

          <ul className="grid gap-3 md:grid-cols-2">
            <li className="rounded-lg border border-border bg-muted px-4 py-4 text-sm leading-6 text-muted-foreground">
              Manifest mode when the stack has real dependencies.
            </li>
            <li className="rounded-lg border border-border bg-muted px-4 py-4 text-sm leading-6 text-muted-foreground">
              Annotation, source navigation, and terminal sessions from the page itself.
            </li>
          </ul>
        </div>
      </div>

      <aside className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5" aria-labelledby="hero-panel-title">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Launch sequence</p>
          <span className="rounded-md border border-border bg-background px-2 py-1 text-[0.72rem] uppercase tracking-[0.2em] text-muted-foreground">
            {props.launchCommands.length} commands
          </span>
        </div>

        <div className="mt-4 grid gap-4">
          <div className="grid gap-3">
            <h2 id="hero-panel-title" className="text-2xl font-medium leading-tight tracking-[-0.06em] text-card-foreground sm:text-3xl">
              From clean boot to routed app in two commands.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Treat the first-run path like an operator checklist: edge first, manifest second, inspection loop last.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-background">
            {props.launchCommands.map((command: string) => {
              return (
                <pre
                  key={command}
                  className="overflow-x-auto border-b border-border px-4 py-4 text-[0.95rem] leading-6 text-foreground last:border-b-0"
                >
                  <code>{command}</code>
                </pre>
              );
            })}
          </div>

          <ul className="grid gap-2 text-sm leading-6 text-muted-foreground">
            <li className="rounded-md border border-border bg-muted px-3 py-3">
              Start the managed edge once, then let devhost own route registration.
            </li>
            <li className="rounded-md border border-border bg-muted px-3 py-3">
              Run the manifest and let health checks decide when a hostname becomes real.
            </li>
            <li className="rounded-md border border-border bg-muted px-3 py-3">
              Open the routed page with devtools that understand the stack around it.
            </li>
          </ul>
        </div>
      </aside>
    </section>
  );
}
