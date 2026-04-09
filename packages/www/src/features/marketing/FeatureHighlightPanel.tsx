import { type JSX } from "react";

import { InsetList } from "../../components/ui";
import { FeatureReplay } from "./FeatureReplay";
import type { IFeatureHighlight } from "./featureHighlights";

export function FeatureHighlightPanel(props: IFeatureHighlight): JSX.Element {
  return (
    <div className="grid gap-4" data-testid="FeatureHighlightPanel">
      <p className="text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">{props.kicker}</p>
      <h3 className="text-balance text-2xl font-medium leading-tight tracking-[-0.05em] text-card-foreground sm:text-3xl">
        {props.title}
      </h3>
      <p className="max-w-[72ch] text-sm leading-7 text-muted-foreground">{props.description}</p>
      <InsetList items={props.bullets} />
      {props.demoRecordingUrl ? (
        <FeatureReplay
          demoRecordingUrl={props.demoRecordingUrl}
          featureId={props.id}
          kicker={props.kicker}
          title={props.title}
        />
      ) : null}
    </div>
  );
}
