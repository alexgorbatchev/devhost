package manifest

import (
	"regexp"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nativebrowser"
)

const defaultReactExtensionID = "fmkadmapgofadopljbjfkapdkoienihi"

var extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

func validateNativeBrowser(rawValue any, schemaIssues *[]string) DevtoolsBrowserConfig {
	result := DevtoolsBrowserConfig{ReactExtensionID: defaultReactExtensionID}
	if rawValue == nil {
		return result
	}
	value, ok := readMap(rawValue, "devtools.browser", schemaIssues)
	if !ok {
		return result
	}
	allowKeys(value, []string{"endpoint", "reactExtensionId"}, "devtools.browser", schemaIssues)
	if endpoint, ok := readOptionalString(value, "endpoint", schemaIssues); ok {
		if endpoint != "" {
			if _, err := nativebrowser.ParseEndpoint(endpoint); err != nil {
				*schemaIssues = append(*schemaIssues, "devtools.browser.endpoint: "+err.Error())
			}
		}
		result.Endpoint = endpoint
	}
	if id, ok := readOptionalString(value, "reactExtensionId", schemaIssues); ok {
		if !extensionIDPattern.MatchString(id) {
			*schemaIssues = append(*schemaIssues, "devtools.browser.reactExtensionId must be a 32-letter Chrome extension ID using a through p.")
		} else {
			result.ReactExtensionID = id
		}
	}
	return result
}
