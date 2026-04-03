export type ThemePreference = "system" | "light" | "dark";

export type InspectionLaneId = "shell" | "contrast" | "scroll";

export interface IThemeOption {
  label: string;
  value: ThemePreference;
}

export interface IAuditMetric {
  label: string;
  value: string;
}

export interface IInspectionLane {
  body: string;
  checklist: string[];
  id: InspectionLaneId;
  kicker: string;
  title: string;
}

export interface IAuditSection {
  body: string;
  eyebrow: string;
  title: string;
}

export interface IDiagnosticSection {
  paragraphs: string[];
  title: string;
}
