export type FeatureHighlightId =
  | "routing"
  | "health-checks"
  | "overlay"
  | "annotation"
  | "source-jumps"
  | "sessions"
  | "stack-contract";

export interface IFeatureHighlight {
  body: string;
  checklist: string[];
  id: FeatureHighlightId;
  kicker: string;
  title: string;
}

export interface IWorkflowStep {
  body: string;
  step: string;
  title: string;
}

export type ProofCardId = "proxy-discipline" | "isolation" | "local-https";

export interface IProofCard {
  body: string;
  eyebrow: string;
  id: ProofCardId;
  title: string;
}

export interface IMarketingContent {
  defaultFeatureId: FeatureHighlightId;
  featureHighlights: IFeatureHighlight[];
  featureSectionProofCardId: ProofCardId;
  launchCommands: string[];
  manifestPreviewLines: string[];
  proofCards: IProofCard[];
  workflowSteps: IWorkflowStep[];
}
