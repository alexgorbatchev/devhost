import { type JSX } from "react";

export interface IMarketingHeroSectionProps {
  themeControl: JSX.Element;
}

export function MarketingHeroSection(props: IMarketingHeroSectionProps): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="hero-title">
      <div className="rounded-lg border border-border-subtle bg-card p-6 shadow-[var(--shadow-raised)] sm:p-8">
        <div className="grid gap-6">
          <div className="flex justify-end">
            <div className="w-full max-w-[180px]">{props.themeControl}</div>
          </div>

          <div className="grid gap-4 justify-items-center text-center">
            <h1
              id="hero-title"
              className="max-w-[22ch] text-balance text-4xl font-medium leading-[1.02] tracking-[-0.06em] text-card-foreground sm:text-5xl lg:text-[4.1rem]"
            >
              devhost is the storefront for routed local stacks.
            </h1>
          </div>
        </div>
      </div>

      <aside
        className="rounded-lg border border-border-subtle bg-card p-4 shadow-[var(--shadow-soft)] sm:p-5"
        aria-labelledby="hero-panel-title"
      >
        <div className="grid gap-4">
          <div className="grid gap-3">
            <h2
              id="hero-panel-title"
              className="text-2xl font-medium leading-tight tracking-[-0.06em] text-card-foreground sm:text-3xl"
            >
              From clean boot to routed app in two commands.
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              Treat the first-run path like an operator checklist: edge first, manifest second, inspection loop last.
            </p>
          </div>

          <div className="overflow-hidden rounded-lg border border-border-subtle bg-terminal text-terminal-foreground shadow-[var(--shadow-soft)]">
            <pre className="overflow-x-auto border-b border-border px-4 py-4 text-[0.95rem] leading-6 text-terminal-foreground">
              <code>bun devhost caddy start</code>
            </pre>
            <pre className="overflow-x-auto px-4 py-4 text-[0.95rem] leading-6 text-terminal-foreground">
              <code>bun devhost --manifest ./test/devhost.toml</code>
            </pre>
          </div>

          <ul className="grid gap-2 text-sm leading-6 text-muted-foreground">
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3">
              Start the managed edge once, then let devhost own route registration.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3">
              Run the manifest and let health checks decide when a hostname becomes real.
            </li>
            <li className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3">
              Open the routed page with devtools that understand the stack around it.
            </li>
          </ul>
        </div>
      </aside>
    </section>
  );
}
