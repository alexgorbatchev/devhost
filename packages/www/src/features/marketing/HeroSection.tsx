import { type JSX } from "react";

import { InsetList, Surface, TerminalSnippet } from "../../components/ui";

export interface IHeroSectionProps {
  themeControl: JSX.Element;
}

interface IHeroHighlight {
  description: string;
  title: string;
}

const heroHighlights: readonly IHeroHighlight[] = [
  {
    description: "Test auth callbacks, cookies, and subdomain behavior on real hostnames instead of fake localhost assumptions.",
    title: "Real browser behavior",
  },
  {
    description: "Start one service or a full stack from devhost.toml and keep dependency order explicit.",
    title: "One command, full stack",
  },
  {
    description: "Reserve the hostname first and only expose it after health checks pass.",
    title: "Routes that earn trust",
  },
  {
    description: "Annotate the page, jump to source, and keep terminal sessions attached to the routed app.",
    title: "Debug where the app lives",
  },
];

const heroCommandSnippets: readonly string[] = [
  "npm install -g @alexgorbatchev/devhost",
  "devhost caddy download\ndevhost caddy trust\ndevhost caddy start",
  "npm run dev\nopen https://foo.localhost",
];

const heroOperationalNotes: readonly string[] = [
  "Use localhost or *.localhost when you want hostnames that resolve locally without extra DNS work.",
  "Wrap devhost in package.json so the stack still starts through the dev command your team already uses.",
  "devhost handles HTTPS routing through Caddy, not DNS, so the chosen hostname still has to resolve to this machine.",
];

export function HeroSection(props: IHeroSectionProps): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="hero-title" data-testid="HeroSection">
      <Surface className="p-6 sm:p-8" shadow="raised">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Managed local edge</p>
              <div className="w-full max-w-[180px]">{props.themeControl}</div>
            </div>

            <div className="grid gap-4">
              <h1
                id="hero-title"
                className="max-w-[12ch] text-balance text-4xl font-medium leading-[1.02] tracking-[-0.06em] text-card-foreground sm:text-5xl lg:max-w-[10ch] lg:text-[4.1rem]"
              >
                Give every local app a real front door.
              </h1>
              <p className="max-w-[72ch] text-balance text-sm leading-7 text-muted-foreground sm:text-base">
                devhost gives your local app real hostnames, local HTTPS, and one command to start and route your dev
                services. Use it when localhost:3000 stops being good enough — auth callbacks, cookie and domain
                behavior, multi-service stacks, or just wanting app.localhost and api.app.localhost to behave more like
                a real app.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {heroHighlights.map((heroHighlight: IHeroHighlight) => {
                return (
                  <Surface key={heroHighlight.title} className="grid gap-2 p-4" tone="subtle">
                    <h2 className="text-lg font-medium leading-tight text-card-foreground">{heroHighlight.title}</h2>
                    <p className="text-sm leading-6 text-muted-foreground">{heroHighlight.description}</p>
                  </Surface>
                );
              })}
            </div>
          </div>

          <Surface element="aside" className="grid gap-4 p-4 sm:p-5" tone="subtle" aria-labelledby="hero-panel-title">
            <div className="grid gap-3">
              <h2
                id="hero-panel-title"
                className="text-2xl font-medium leading-tight tracking-[-0.06em] text-card-foreground sm:text-3xl"
              >
                Go from install to routed app fast.
              </h2>
              <p className="text-sm leading-7 text-muted-foreground">
                Trust the local certificate once, start the shared edge, and let the routed stack come up through the
                same dev script you already use.
              </p>
            </div>

            <TerminalSnippet snippets={heroCommandSnippets} />
            <InsetList items={heroOperationalNotes} />
          </Surface>
        </div>
      </Surface>
    </section>
  );
}
