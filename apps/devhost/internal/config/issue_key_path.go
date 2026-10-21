package config

import (
	"strconv"
	"strings"
)

const unrecognizedKeyPrefix = "Unrecognized key: "

// IssueKeyPath returns the setting a ValidationError issue names, such as caddy.httpsPort, or "" when it names none.
func IssueKeyPath(issue string) string {
	if quoted, ok := strings.CutPrefix(issue, unrecognizedKeyPrefix); ok {
		if key, err := strconv.Unquote(quoted); err == nil {
			return key
		}
		return ""
	}
	key, _, _ := strings.Cut(issue, " ")
	if strings.HasPrefix(key, "caddy.") {
		return key
	}
	return ""
}
