// Package statuspage shares the presentation of devhost's standalone status pages.
package statuspage

import _ "embed"

// ThemeScript follows the system preference before the document paints.
//
//go:embed theme.js
var ThemeScript string
