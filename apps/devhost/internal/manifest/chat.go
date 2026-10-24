package manifest

const defaultChatPrompt = `Implement the user's requested changes and page annotations. Treat follow-up messages as additional work for the current task, preserving earlier requirements unless the user changes them.

Work in a dedicated Git worktree on a new branch, following the repository's instructions. Reuse that worktree for related follow-ups. Preserve unrelated changes and other worktrees. Run the required checks, commit your changes, merge the branch into local main, and verify the merged result. After a successful merge, remove your worktree and delete your branch. Leave remote publishing to an explicit user request. If main is unavailable, checks fail, or a merge cannot be completed safely, retain your worktree and report the exact blocker. Summarize the changes, validation, merge, and cleanup.`

type DevtoolsChatConfig struct {
	Enabled bool
	Prompt  string
}

func validateDevtoolsChat(raw any, issues *[]string) DevtoolsChatConfig {
	result := DevtoolsChatConfig{Enabled: true, Prompt: defaultChatPrompt}
	if raw == nil {
		return result
	}
	value, ok := readMap(raw, "devtools.chat", issues)
	if !ok {
		return result
	}
	allowKeys(value, "devtools.chat", "devtools.chat", issues)
	if enabled, ok := readOptionalBool(value, "devtools.chat", "enabled", issues); ok {
		result.Enabled = enabled
	}
	if prompt, ok := readOptionalString(value, "devtools.chat", "prompt", issues); ok {
		result.Prompt = prompt
	}
	return result
}
