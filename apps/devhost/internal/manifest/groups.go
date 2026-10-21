package manifest

import (
	"fmt"
	"maps"
	"slices"
)

func validateGroups(raw any, services map[string]ValidatedService, schemaIssues, validationIssues *[]string) map[string][]string {
	if raw == nil {
		return nil
	}
	value, ok := readMap(raw, "groups", schemaIssues)
	if !ok {
		return nil
	}
	groups := make(map[string][]string, len(value))
	for _, name := range slices.Sorted(maps.Keys(value)) {
		path := "groups." + name
		if !serviceNamePattern.MatchString(name) {
			*validationIssues = append(*validationIssues, path+" has an invalid name.")
		}
		if _, exists := services[name]; exists {
			*validationIssues = append(*validationIssues, path+" conflicts with a service name.")
		}
		members, ok := readOptionalStringArray(value, "groups", name, schemaIssues)
		if !ok {
			continue
		}
		for _, member := range members {
			if _, exists := services[member]; !exists {
				*validationIssues = append(*validationIssues, fmt.Sprintf("%s references an unknown service: %s", path, member))
			}
		}
		groups[name] = members
	}
	return groups
}

func mergeIncludedGroups(parent, child map[string]any, parentPath, childPath string) error {
	raw, exists := child["groups"]
	if !exists {
		return nil
	}
	groups, ok := raw.(map[string]any)
	if !ok {
		return fmt.Errorf("groups in %s must be a table", childPath)
	}
	if _, exists := parent["groups"]; !exists {
		parent["groups"] = map[string]any{}
	}
	merged, ok := parent["groups"].(map[string]any)
	if !ok {
		return fmt.Errorf("groups in %s must be a table", parentPath)
	}
	for _, name := range slices.Sorted(maps.Keys(groups)) {
		if _, exists := merged[name]; exists {
			return fmt.Errorf("group %q is defined multiple times (conflict in %s)", name, childPath)
		}
		merged[name] = groups[name]
	}
	return nil
}
