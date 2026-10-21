package app

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func failStart(stderr, serviceStderr io.Writer, cwd string, err error) int {
	var conflict *caddy.ManifestOverlapError
	if !errors.As(err, &conflict) {
		return fail(stderr, err)
	}
	message := conflict.Error()
	var explicit *string
	if path := os.Getenv("DEVHOST_MANIFEST"); path != "" {
		explicit = &path
	}
	if path, resolveErr := resolveManifestPath(explicit, cwd); resolveErr == nil {
		selected, selectedErr := os.Stat(path)
		owner, ownerErr := os.Stat(conflict.Owner.ManifestPath)
		if selectedErr == nil && ownerErr == nil && os.SameFile(selected, owner) {
			message = conflict.Message("devhost stop")
		}
	}
	var output strings.Builder
	cliout.WriteFailure(&output, errors.New(message))
	for line := range strings.SplitSeq(strings.TrimSuffix(output.String(), "\n"), "\n") {
		_, _ = fmt.Fprintln(serviceStderr, "[devhost] "+line) // No further reporting is possible if stderr fails.
	}
	return 1
}
