import { type JSX } from "react";

import { InsetList, Surface, TerminalSnippet } from "../../components/ui";

export interface IHeroSectionProps {
  themeControl: JSX.Element;
}

const heroChecklistItems: readonly string[] = [
  "Start the managed edge once, then let devhost own route registration.",
  "Run the manifest and let health checks decide when a hostname becomes real.",
  "Open the routed page with devtools that understand the stack around it.",
];

const heroCommandSnippets: readonly string[] = [
  "bun devhost caddy start",
  "bun devhost --manifest ./test/devhost.toml",
];

export function HeroSection(props: IHeroSectionProps): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="hero-title">
      <Surface className="p-6 sm:p-8" shadow="raised">
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
      </Surface>

      <Surface element="aside" className="p-4 sm:p-5" aria-labelledby="hero-panel-title">
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

          <TerminalSnippet snippets={heroCommandSnippets} />
          <InsetList items={heroChecklistItems} />
        </div>
      </Surface>
    </section>
  );
}
