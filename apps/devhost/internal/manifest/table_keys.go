package manifest

import (
	"fmt"
	"sort"
)

// tableKeys lists the keys each manifest table accepts, by table path. "*" stands for a name the manifest chooses,
// such as a service or a resource readout. The root table also accepts "caddy", so a
// manifest that still sets the shared Caddy listeners gets the error that points to the devhost config file.
var tableKeys = map[string][]string{
	"":                          {"caddy", "devtools", "worktrees", "name", "services", "groups", "includes", "killZombies"},
	"worktrees":                 {"enabled"},
	"devtools":                  {"annotations", "chat", "configEditor", "editor", "externalToolbars", "idleTimeout", "minimap", "resources", "status", "shortcuts"},
	"devtools.annotations":      {"enabled"},
	"devtools.chat":             {"enabled", "prompt"},
	"devtools.configEditor":     {"enabled"},
	"devtools.editor":           {"enabled", "ide"},
	"devtools.externalToolbars": {"enabled"},
	"devtools.minimap":          {"enabled"},
	"devtools.resources":        {"cpu", "disk", "enabled", "memory", "pollInterval"},
	"devtools.resources.*":      {"enabled", "pollInterval"},
	"devtools.status":           {"enabled", "position"},
	"devtools.shortcuts":        {"restartServices"},
	"services.*":                {"alwaysStart", "bindHost", "command", "cwd", "dependsOn", "env", "health", "host", "injectPort", "lifecycle", "managed", "path", "port", "primary", "proxyLocalOrigin", "serve", "watch"},
	"services.*.health":         {"http", "interval", "process", "retries", "tcp", "timeout"},
	"services.*.lifecycle":      {"mode", "start", "status", "stop"},
}

// allowKeys reports every key of value that the table does not accept, under path, the table's place in this
// manifest.
func allowKeys(value map[string]any, table string, path string, schemaIssues *[]string) {
	allowedKeys, ok := tableKeys[table]
	if !ok {
		panic(fmt.Sprintf("manifest table %q has no key list", table))
	}
	allowedKeySet := map[string]struct{}{}
	for _, allowedKey := range allowedKeys {
		allowedKeySet[allowedKey] = struct{}{}
	}

	unknownKeys := []string{}
	for key := range value {
		if _, ok := allowedKeySet[key]; ok {
			continue
		}
		unknownKeys = append(unknownKeys, key)
	}
	sort.Strings(unknownKeys)

	for _, unknownKey := range unknownKeys {
		issuePath := path
		if issuePath == "" {
			issuePath = rootIssuePath
		}
		*schemaIssues = append(*schemaIssues, fmt.Sprintf("%s Unrecognized key: \"%s\"", issuePath, unknownKey))
	}
}
