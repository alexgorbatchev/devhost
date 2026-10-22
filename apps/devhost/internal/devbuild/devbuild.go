// Package devbuild carries what a development build knows about the checkout
// it was built from. Release builds leave it empty.
package devbuild

// sourceDirectory is stamped with -ldflags -X by `just dev-bootstrap` and
// scripts/runFromSource.sh.
var sourceDirectory string

// SourceDirectory is the absolute root of the devhost checkout this binary was
// built from, or "" for a build that does not name one.
func SourceDirectory() string {
	return sourceDirectory
}
