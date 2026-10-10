// Package statuspage shares the presentation of devhost's standalone status pages.
package statuspage

import _ "embed"

// CSS styles both the managed proxy's 404 page and service recovery documents.
//
//go:embed status.css
var CSS string
