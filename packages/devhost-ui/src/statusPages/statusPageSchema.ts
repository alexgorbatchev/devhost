import { z } from "zod";

const ownerSchema = z.object({
  id: z.string(),
  name: z.string(),
  pid: z.number(),
  manifestPath: z.string(),
  urls: z
    .array(z.string())
    .nullish()
    .transform((urls) => urls ?? []),
});
const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  selectedPath: z.string(),
  switching: z.boolean(),
  blockedReason: z.string().optional(),
  error: z.string().optional(),
  worktrees: z
    .array(
      z.object({
        path: z.string(),
        branch: z.string(),
        head: z.string(),
        available: z.boolean(),
        reason: z.string().optional(),
        owners: z
          .array(ownerSchema)
          .nullish()
          .transform((owners) => owners ?? []),
      }),
    )
    .nullish()
    .transform((worktrees) => worktrees ?? []),
});

export const worktreesSchema = z.object({
  repositories: z
    .array(repositorySchema)
    .nullish()
    .transform((repositories) => repositories ?? []),
});

export const recoverySchema = worktreesSchema.extend({
  stack: z.string(),
  service: z.string(),
  phase: z.string(),
  title: z.string(),
  message: z.string(),
  address: z.string(),
  canRestart: z.boolean(),
  logs: z
    .array(z.string())
    .nullish()
    .transform((logs) => logs ?? []),
});

export const statusPageSchema = z.object({
  kind: z.enum(["recovery", "not-found", "unavailable"]),
  status: z.number(),
  title: z.string(),
  message: z.string(),
  routes: z
    .array(z.object({ host: z.string(), url: z.string() }))
    .nullish()
    .transform((routes) => routes ?? []),
  recovery: recoverySchema.nullish(),
});
