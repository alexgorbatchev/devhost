import Anser from "anser";
import { z } from "zod";
import type { IChatPendingRequest } from "./types";
import type { IChatApproval } from "./approvals/types";

const codexApproval = z.object({ params: z.looseObject({ reason: z.string().nullish() }) });
const codexPermissions = z.object({
  params: z.looseObject({ reason: z.string().nullish(), permissions: z.record(z.string(), z.unknown()) }),
});
const claudeApproval = z.object({
  request: z.looseObject({
    subtype: z.literal("can_use_tool"),
    tool_name: z.string(),
    input: z.record(z.string(), z.unknown()),
    title: z.string().optional(),
    description: z.string().optional(),
    decision_reason: z.string().optional(),
    requires_user_interaction: z.boolean().optional(),
  }),
});

/** Build explicit, single-request decisions from the harness's native request. */
export function readChatApproval(request: IChatPendingRequest): IChatApproval | null {
  if (request.harness === "claude-code") {
    const parsed = claudeApproval.safeParse(request.payload);
    if (
      !parsed.success ||
      parsed.data.request.tool_name === "AskUserQuestion" ||
      parsed.data.request.requires_user_interaction
    )
      return null;
    const native = parsed.data.request;
    const description = native.decision_reason ?? native.description;
    return {
      title: Anser.ansiToText(native.title ?? `Allow ${native.tool_name}`),
      description: description === undefined ? undefined : Anser.ansiToText(description),
      details: native,
      allow: { behavior: "allow", updatedInput: native.input },
      deny: { behavior: "deny", message: "Denied by the user." },
    };
  }
  if (request.method === "item/permissions/requestApproval") {
    const parsed = codexPermissions.safeParse(request.payload);
    if (!parsed.success) return null;
    return {
      title: "Grant access for this turn",
      description: parsed.data.params.reason ?? undefined,
      details: parsed.data.params,
      allow: { permissions: parsed.data.params.permissions, scope: "turn" },
      deny: { permissions: {}, scope: "turn" },
    };
  }
  if (
    request.method !== "item/commandExecution/requestApproval" &&
    request.method !== "item/fileChange/requestApproval"
  )
    return null;
  const parsed = codexApproval.safeParse(request.payload);
  if (!parsed.success) return null;
  return {
    title: request.method === "item/fileChange/requestApproval" ? "Change files" : "Run command",
    description: parsed.data.params.reason ?? undefined,
    details: parsed.data.params,
    allow: { decision: "accept" },
    deny: { decision: "decline" },
  };
}
