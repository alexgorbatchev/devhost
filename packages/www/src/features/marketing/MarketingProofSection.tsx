import React, { type JSX } from "react";

import type { IProofCard, ProofCardId } from "./types";

export interface IMarketingProofSectionProps {
  excludedProofCardId: ProofCardId;
  proofCards: IProofCard[];
}

export function MarketingProofSection(props: IMarketingProofSectionProps): JSX.Element {
  const proofGridCards: IProofCard[] = props.proofCards.filter((proofCard: IProofCard): boolean => {
    return proofCard.id !== props.excludedProofCardId;
  });

  return (
    <section className="grid gap-4" aria-labelledby="proof-section-title">
      <div className="grid gap-3">
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">Why this shell is credible</p>
        <h2 id="proof-section-title" className="max-w-[18ch] text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl">
          The page now sells the real constraints, not decorative abstractions.
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {proofGridCards.map((proofCard: IProofCard) => {
          return (
            <article key={proofCard.id} className="rounded-lg border border-border bg-card p-5 shadow-sm">
              <div className="grid gap-3">
                <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">{proofCard.eyebrow}</p>
                <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                  {proofCard.title}
                </h3>
                <p className="text-sm leading-7 text-muted-foreground">{proofCard.body}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
