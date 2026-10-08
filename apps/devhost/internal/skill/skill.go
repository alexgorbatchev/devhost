// Package skill carries devhost's usage guide for AI agents inside the binary.
package skill

import _ "embed"

// document is devhost/SKILL.md itself, the file contributors maintain. Embedding
// that file means `devhost skill` needs nothing on disk at runtime and has no
// second copy to fall behind.
//
//go:embed devhost/SKILL.md
var document string

// Document returns the guide byte for byte.
func Document() string {
	return document
}
