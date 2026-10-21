package manifest

import "slices"

type agentAdapter struct {
	name  string
	label string
}

// agentAdapters are the built-in agent adapters and the labels their actions take when the manifest sets none.
var agentAdapters = []agentAdapter{
	{name: "pi", label: "Pi"},
	{name: "claude-code", label: "Claude Code"},
	{name: "opencode", label: "OpenCode"},
	{name: "codex", label: "Codex"},
}

// The values the manifest accepts for each setting that takes one of a fixed list. Validation and the config
// editor's completion read the same lists.
var (
	annotationActionKinds   = []string{"agent", "command"}
	componentEditors        = []string{"cursor", "neovim", "vscode", "vscode-insiders", "webstorm"}
	serviceBindHosts        = []string{"127.0.0.1", "0.0.0.0", "::1", "::"}
	serviceLifecycleModes   = []string{"foreground", "daemon"}
	devtoolsStatusPositions = []string{"top-right", "bottom-right"}
)

func agentAdapterLabel(name string) (string, bool) {
	index := slices.IndexFunc(agentAdapters, func(adapter agentAdapter) bool { return adapter.name == name })
	if index < 0 {
		return "", false
	}
	return agentAdapters[index].label, true
}

func agentAdapterNames() []string {
	names := make([]string, 0, len(agentAdapters))
	for _, adapter := range agentAdapters {
		names = append(names, adapter.name)
	}
	return names
}

// Schema describes the settings a configuration file accepts, so the config editor can complete them.
type Schema struct {
	// Tables lists the keys each table accepts, by table path. The root table is "", and "*" stands for a name the
	// file chooses, such as a service.
	Tables map[string][]string `json:"tables"`
	// Values lists the values a setting accepts, by key path, for settings that take one of a fixed list.
	Values map[string][]string `json:"values"`
}

// ReadSchema describes the settings a manifest accepts.
func ReadSchema() Schema {
	tables := make(map[string][]string, len(tableKeys))
	for table, keys := range tableKeys {
		// The root table accepts caddy only to explain where its settings moved.
		tables[table] = slices.DeleteFunc(slices.Clone(keys), func(key string) bool { return table == "" && key == "caddy" })
	}
	return Schema{
		Tables: tables,
		Values: map[string][]string{
			"annotation.agent":                   agentAdapterNames(),
			"annotation.actions.*.kind":          slices.Clone(annotationActionKinds),
			"annotation.actions.*.agent.adapter": agentAdapterNames(),
			"devtools.editor.ide":                slices.Clone(componentEditors),
			"devtools.status.position":           slices.Clone(devtoolsStatusPositions),
			"services.*.bindHost":                slices.Clone(serviceBindHosts),
			"services.*.lifecycle.mode":          slices.Clone(serviceLifecycleModes),
		},
	}
}
