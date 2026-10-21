// Package choices words a setting's allowed values for the issues that reject other values.
package choices

import "strings"

// Format lists values the way an issue names them: "a", "a or b", or "a, b, or c".
func Format(values []string) string {
	if len(values) < 3 {
		return strings.Join(values, " or ")
	}
	return strings.Join(values[:len(values)-1], ", ") + ", or " + values[len(values)-1]
}
