import { type JSX } from "react";

export function MarketingProofSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="proof-section-title">
      <div className="grid gap-3">
        <h2
          id="proof-section-title"
          className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl"
        >
          The page now sells the real constraints, not decorative abstractions.
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-lg border border-border-subtle bg-card p-5 shadow-[var(--shadow-soft)]">
          <div className="grid gap-3">
            <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
              Devtools stay off the noisy traffic
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              Document navigations are injected, but assets and hot-reload traffic stay on the direct app path.
            </p>
          </div>
        </article>

        <article className="rounded-lg border border-border-subtle bg-card p-5 shadow-[var(--shadow-soft)]">
          <div className="grid gap-3">
            <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
              The debugging shell is visually contained
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">
              The overlay lives inside its own Shadow DOM container so host styles do not quietly corrupt the tooling
              UI.
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
