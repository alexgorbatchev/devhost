export type ThemePreference = "system" | "light" | "dark";

export type FeatureHighlightId =
  | "routing"
  | "health-checks"
  | "overlay"
  | "annotation"
  | "source-jumps"
  | "sessions"
  | "stack-contract";

export interface IThemeOption {
  label: string;
  value: ThemePreference;
}

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
