import React, { type JSX } from "react";

export interface IMarketingHeroSectionProps {
  launchCommands: string[];
}

export function MarketingHeroSection(props: IMarketingHeroSectionProps): JSX.Element {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="panel-kicker">Managed local stacks behind real hosts</p>
        <h1 id="hero-title" className="app-title">
          devhost is the storefront for routed local stacks.
        </h1>
        <p className="app-body">
          Start the app, wait for health, route a real hostname through managed Caddy, and layer source-aware
          devtools on top without dragging every asset request through the proxy.
        </p>
        <ul className="hero-bullets">
          <li>Manifest mode when the stack has real dependencies.</li>
          <li>Annotation, source navigation, and terminal sessions from the page itself.</li>
        </ul>
      </div>

      <aside className="hero-panel" aria-labelledby="hero-panel-title">
        <p className="panel-kicker">Launch sequence</p>
        <h2 id="hero-panel-title" className="section-title">
          From clean boot to routed app in two commands.
        </h2>
        <div className="command-stack">
          {props.launchCommands.map((command: string) => {
            return (
              <pre key={command} className="command-card">
                <code>{command}</code>
              </pre>
            );
          })}
        </div>
        <ul className="bullet-list">
          <li>Start the managed edge once, then let devhost own route registration.</li>
          <li>Run the manifest and let health checks decide when a hostname becomes real.</li>
          <li>Open the routed page with devtools that understand the stack around it.</li>
        </ul>
      </aside>
    </section>
  );
}
