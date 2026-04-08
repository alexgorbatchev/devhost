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
    <section className="proof-section" aria-labelledby="proof-section-title">
      <div className="section-intro">
        <p className="panel-kicker">Why this shell is credible</p>
        <h2 id="proof-section-title" className="section-title">
          The page now sells the real constraints, not decorative abstractions.
        </h2>
      </div>

      <div className="proof-grid">
        {proofGridCards.map((proofCard: IProofCard) => {
          return (
            <article key={proofCard.id} className="proof-card">
              <p className="panel-kicker">{proofCard.eyebrow}</p>
              <h3 className="proof-card__title">{proofCard.title}</h3>
              <p className="proof-card__body">{proofCard.body}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
