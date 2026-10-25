import type { z } from "zod";
import type { recoverySchema, statusPageSchema } from "./statusPageSchema";

export type StatusPageData = z.infer<typeof statusPageSchema>;
export type DirectoryStack = NonNullable<StatusPageData["stacks"]>[number];
export type FilePageData = NonNullable<StatusPageData["files"]>;
export type RecoveryState = z.infer<typeof recoverySchema>;
export type RecoveryRepository = RecoveryState["repositories"][number];
export type RecoveryOwner = RecoveryRepository["worktrees"][number]["owners"][number];

export interface IWorktreeSelection {
  repositoryId: string;
  path: string;
  stopOwnerId?: string;
}

export interface IRecoveryClient {
  readStatus: (signal: AbortSignal) => Promise<RecoveryState>;
  readWorktrees: (signal: AbortSignal) => Promise<RecoveryRepository[]>;
  probe: (signal: AbortSignal) => Promise<boolean>;
  restart: (signal: AbortSignal) => Promise<void>;
  switchWorktree: (selection: IWorktreeSelection, signal: AbortSignal) => Promise<void>;
  reload: () => void;
}
