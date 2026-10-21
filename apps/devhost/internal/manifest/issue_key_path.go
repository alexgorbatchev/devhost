package manifest

import (
	"regexp"
	"slices"
	"strings"
)

// rootIssuePath is the path issues give the root table.
const rootIssuePath = "manifest"

var (
	issueKeyPathPattern       = regexp.MustCompile(`^([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_*-]+|\[\d+\])*)(?: |$)`)
	unrecognizedIssueKeyRegex = regexp.MustCompile(` Unrecognized key: "([^"]+)"$`)
)

// IssueKeyPath returns the setting a ValidationError issue names, such as services.api.port, or "" when it names
// none. Issues start with the path of the key they concern, and an unrecognized key is named after its table.
func IssueKeyPath(issue string) string {
	match := issueKeyPathPattern.FindStringSubmatch(issue)
	if match == nil {
		return ""
	}
	path := match[1]
	if path == rootIssuePath {
		path = ""
	} else if root, _, _ := strings.Cut(strings.SplitN(path, "[", 2)[0], "."); !slices.Contains(tableKeys[""], root) {
		return ""
	}
	if unknown := unrecognizedIssueKeyRegex.FindStringSubmatch(issue); unknown != nil {
		if path == "" {
			return unknown[1]
		}
		return path + "." + unknown[1]
	}
	return path
}
