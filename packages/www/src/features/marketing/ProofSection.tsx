import { type JSX } from "react";

import { SectionHeader, Surface } from "../../components/ui";

interface IProofCard {
  description: string;
  title: string;
}

const proofCards: readonly IProofCard[] = [
  {
    description: "Document navigations are injected, but assets and hot-reload traffic stay on the direct app path.",
    title: "Devtools stay off the noisy traffic",
  },
  {
    description:
      "The overlay lives inside its own Shadow DOM container so host styles do not quietly corrupt the tooling UI.",
    title: "The debugging shell is visually contained",
  },
];

export function ProofSection(): JSX.Element {
  return (
    <section className="grid gap-4" aria-labelledby="proof-section-title" data-testid="ProofSection">
      <SectionHeader
        title="The page now sells the real constraints, not decorative abstractions."
        titleId="proof-section-title"
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {proofCards.map((proofCard: IProofCard) => {
          return (
            <Surface key={proofCard.title} element="article" className="p-5">
              <div className="grid gap-3">
                <h3 className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
                  {proofCard.title}
                </h3>
                <p className="text-sm leading-7 text-muted-foreground">{proofCard.description}</p>
              </div>
            </Surface>
          );
        })}
      </div>
    </section>
  );
}
