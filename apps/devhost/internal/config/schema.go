package config

import (
	"reflect"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// Schema describes the settings the config file accepts, so the config editor can complete them.
type Schema struct {
	// Tables lists the keys each table accepts, by table path; the root table is "".
	Tables map[string][]string `json:"tables"`
	// Values lists the values a setting accepts, by key path, for settings that take one of a fixed list.
	Values map[string][]string `json:"values"`
}

// ReadSchema describes the settings the config file accepts, from the same fields Parse decodes.
func ReadSchema() Schema {
	return Schema{
		Tables: map[string][]string{
			"":      readTOMLKeys(reflect.TypeFor[fileContents]()),
			"caddy": readTOMLKeys(reflect.TypeFor[caddyContents]()),
		},
		Values: map[string][]string{
			"caddy.bindHost": slices.Clone(caddy.SupportedManagedCaddyBindHosts),
		},
	}
}

func readTOMLKeys(contents reflect.Type) []string {
	keys := make([]string, 0, contents.NumField())
	for field := range contents.Fields() {
		key, _, _ := strings.Cut(field.Tag.Get("toml"), ",")
		keys = append(keys, key)
	}
	return keys
}
