import React, { useRef, useState, type JSX, type KeyboardEvent } from "react";

import { MarketingFeatureReplay } from "./MarketingFeatureReplay";
import type { FeatureHighlightId, IFeatureHighlight, IProofCard, ProofCardId } from "./types";

export interface IMarketingFeatureSectionProps {
  defaultFeatureId: FeatureHighlightId;
  featureHighlights: IFeatureHighlight[];
  featureSectionProofCardId: ProofCardId;
  proofCards: IProofCard[];
}

export function MarketingFeatureSection(props: IMarketingFeatureSectionProps): JSX.Element {
  const [activeFeatureId, setActiveFeatureId] = useState<FeatureHighlightId>(props.defaultFeatureId);
  const featureTabRefs = useRef<Map<FeatureHighlightId, HTMLButtonElement>>(new Map());
  const activeFeature: IFeatureHighlight = findFeatureHighlightById(props.featureHighlights, activeFeatureId);
  const activeFeaturePanelId: string = createFeaturePanelId(activeFeatureId);
  const activeFeatureTabId: string = createFeatureTabId(activeFeatureId);
  const featureSectionProofCard: IProofCard = findProofCardById(props.proofCards, props.featureSectionProofCardId);

  function handleFeatureTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, featureIndex: number): void {
    const lastFeatureIndex: number = props.featureHighlights.length - 1;

    let nextFeatureIndex: number | null = null;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight": {
        nextFeatureIndex = featureIndex === lastFeatureIndex ? 0 : featureIndex + 1;
        break;
      }
      case "ArrowLeft":
      case "ArrowUp": {
        nextFeatureIndex = featureIndex === 0 ? lastFeatureIndex : featureIndex - 1;
        break;
      }
      case "Home": {
        nextFeatureIndex = 0;
        break;
      }
      case "End": {
        nextFeatureIndex = lastFeatureIndex;
        break;
      }
      default: {
        return;
      }
    }

    event.preventDefault();

    if (nextFeatureIndex === null) {
      return;
    }

    const nextFeature = props.featureHighlights[nextFeatureIndex];

    if (nextFeature === undefined) {
      return;
    }

    setActiveFeatureId(nextFeature.id);
    featureTabRefs.current.get(nextFeature.id)?.focus();
  }

  return (
    <section className="grid gap-4" aria-labelledby="feature-section-title">
      <div className="grid gap-3">
        <h2 id="feature-section-title" className="text-balance text-3xl font-medium leading-tight tracking-[-0.06em] text-foreground sm:text-4xl">
          A routed development surface, not another localhost wrapper.
        </h2>
        <p className="text-sm leading-7 text-muted-foreground">
          The point is not to proxy everything. The point is to expose the right host, keep the stack honest, and
          put the debugging workflow where the page already lives.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_280px]">
        <div className="rounded-lg border border-border-subtle bg-card p-2 shadow-[var(--shadow-soft)]">
          <div className="grid gap-2" role="tablist" aria-label="Devhost product highlights" aria-orientation="vertical">
            {props.featureHighlights.map((featureHighlight: IFeatureHighlight, featureIndex: number) => {
              const isActive: boolean = featureHighlight.id === activeFeatureId;
              const featurePanelId: string = createFeaturePanelId(featureHighlight.id);
              const featureTabId: string = createFeatureTabId(featureHighlight.id);

              return (
                <button
                  key={featureHighlight.id}
                  id={featureTabId}
                  ref={(element: HTMLButtonElement | null): void => {
                    if (element === null) {
                      featureTabRefs.current.delete(featureHighlight.id);
                      return;
                    }

                    featureTabRefs.current.set(featureHighlight.id, element);
                  }}
                  type="button"
                  role="tab"
                  className={
                    isActive
                      ? "flex w-full items-center justify-between rounded-md border border-transparent bg-primary px-3 py-3 text-left text-sm leading-5 text-primary-foreground shadow-[var(--shadow-soft)]"
                      : "flex w-full items-center justify-between rounded-md border border-transparent px-3 py-3 text-left text-sm leading-5 text-muted-foreground transition hover:border-border-subtle hover:bg-surface-subtle hover:text-foreground"
                  }
                  aria-controls={featurePanelId}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={(): void => {
                    setActiveFeatureId(featureHighlight.id);
                  }}
                  onKeyDown={(event: KeyboardEvent<HTMLButtonElement>): void => {
                    handleFeatureTabKeyDown(event, featureIndex);
                  }}
                >
                  <span>{featureHighlight.kicker}</span>
                  <span aria-hidden="true" className="text-[0.72rem] uppercase tracking-[0.22em] opacity-70">
                    {String(featureIndex + 1).padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <article
          id={activeFeaturePanelId}
          className="rounded-lg border border-border-subtle bg-card p-5 shadow-[var(--shadow-soft)] sm:p-6"
          role="tabpanel"
          aria-labelledby={activeFeatureTabId}
        >
          <div className="grid gap-4">
            <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
              {activeFeature.title}
            </h3>
            <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{activeFeature.body}</p>
            {activeFeature.checklist.length > 0 ? (
              <ul className="grid gap-2">
                {activeFeature.checklist.map((checklistItem: string) => {
                  return (
                    <li key={checklistItem} className="rounded-md border border-border-subtle bg-surface-subtle px-3 py-3 text-sm leading-6 text-muted-foreground">
                      {checklistItem}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <MarketingFeatureReplay featureHighlight={activeFeature} />
          </div>
        </article>

        <aside className="rounded-lg border border-border-subtle bg-surface-subtle p-5 shadow-[var(--shadow-soft)]" aria-labelledby="feature-proof-card-title">
          <div className="grid gap-3">
            <h3 id="feature-proof-card-title" className="text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground">
              {featureSectionProofCard.title}
            </h3>
            <p className="text-sm leading-7 text-muted-foreground">{featureSectionProofCard.body}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function createFeaturePanelId(featureHighlightId: FeatureHighlightId): string {
  return `feature-panel-${featureHighlightId}`;
}

function createFeatureTabId(featureHighlightId: FeatureHighlightId): string {
  return `feature-tab-${featureHighlightId}`;
}

function findFeatureHighlightById(
  featureHighlights: IFeatureHighlight[],
  activeFeatureId: FeatureHighlightId,
): IFeatureHighlight {
  const activeFeature: IFeatureHighlight | undefined = featureHighlights.find((featureHighlight: IFeatureHighlight): boolean => {
    return featureHighlight.id === activeFeatureId;
  });

  if (activeFeature === undefined) {
    throw new Error(`Missing feature highlight for id: ${activeFeatureId}`);
  }

  return activeFeature;
}

function findProofCardById(proofCards: IProofCard[], proofCardId: ProofCardId): IProofCard {
  const proofCard: IProofCard | undefined = proofCards.find((candidateProofCard: IProofCard): boolean => {
    return candidateProofCard.id === proofCardId;
  });

  if (proofCard === undefined) {
    throw new Error(`Missing proof card for id: ${proofCardId}`);
  }

  return proofCard;
}
