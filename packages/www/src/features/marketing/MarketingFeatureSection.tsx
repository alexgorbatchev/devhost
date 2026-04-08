import React, { useRef, useState, type JSX, type KeyboardEvent } from "react";

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
    <section className="feature-section" aria-labelledby="feature-section-title">
      <div className="section-intro">
        <p className="panel-kicker">What you are buying</p>
        <h2 id="feature-section-title" className="section-title">
          A routed development surface, not another localhost wrapper.
        </h2>
        <p className="section-body">
          The point is not to proxy everything. The point is to expose the right host, keep the stack honest, and
          put the debugging workflow where the page already lives.
        </p>
      </div>

      <div className="feature-layout">
        <div className="feature-tab-list" role="tablist" aria-label="Devhost product highlights" aria-orientation="vertical">
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
                className="feature-button"
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
                {featureHighlight.kicker}
              </button>
            );
          })}
        </div>

        <article id={activeFeaturePanelId} className="feature-detail" role="tabpanel" aria-labelledby={activeFeatureTabId}>
          <p className="panel-kicker">{activeFeature.kicker}</p>
          <h3 className="section-title">{activeFeature.title}</h3>
          <p className="section-body">{activeFeature.body}</p>
          {activeFeature.checklist.length > 0 ? (
            <ul className="bullet-list">
              {activeFeature.checklist.map((checklistItem: string) => {
                return <li key={checklistItem}>{checklistItem}</li>;
              })}
            </ul>
          ) : null}
        </article>

        <aside className="proof-card feature-proof-card" aria-labelledby="feature-proof-card-title">
          <p className="panel-kicker">{featureSectionProofCard.eyebrow}</p>
          <h3 id="feature-proof-card-title" className="proof-card__title">
            {featureSectionProofCard.title}
          </h3>
          <p className="proof-card__body">{featureSectionProofCard.body}</p>
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
