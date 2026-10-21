package manifest

import "slices"

// The values the manifest accepts for each setting that takes one of a fixed list. Validation and the config
// editor's completion read the same lists.
var (
	componentEditors        = []string{"cursor", "vscode", "vscode-insiders", "webstorm"}
	serviceBindHosts        = []string{"127.0.0.1", "0.0.0.0", "::1", "::"}
	serviceLifecycleModes   = []string{"foreground", "daemon"}
	devtoolsStatusPositions = []string{"top-right", "bottom-right"}
)

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
			"devtools.editor.ide":       slices.Clone(componentEditors),
			"devtools.status.position":  slices.Clone(devtoolsStatusPositions),
			"services.*.bindHost":       slices.Clone(serviceBindHosts),
			"services.*.lifecycle.mode": slices.Clone(serviceLifecycleModes),
		},
	}
}
