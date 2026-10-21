// Package statuspage shares the presentation of devhost's standalone status pages.
package statuspage

import _ "embed"

// CSS includes the shared design tokens, bundled by buildDevtoolsBundle.ts.
//
//go:embed dist/status.css
var CSS string

// ThemeScript follows the system preference before the document paints.
//
//go:embed theme.js
var ThemeScript string
