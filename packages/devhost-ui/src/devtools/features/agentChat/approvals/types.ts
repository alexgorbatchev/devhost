export interface IChatApproval {
  title: string;
  description: string | undefined;
  details: Record<string, unknown>;
  allow: unknown;
  deny: unknown;
}
