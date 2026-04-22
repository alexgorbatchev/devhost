package caddy

import (
	"errors"
	"fmt"
	"io"
	"os"
)

func PrintManagedCaddyRootCertificate(stdout io.Writer, paths Paths) (int, error) {
	certificate, error := os.ReadFile(paths.RootCertificatePath)
	if error != nil {
		if errors.Is(error, os.ErrNotExist) {
			return 0, fmt.Errorf("Managed Caddy root certificate not found at %s. Run 'devhost caddy start' first.", paths.RootCertificatePath)
		}

		return 0, error
	}

	if _, error := stdout.Write(certificate); error != nil {
		return 0, fmt.Errorf("write managed caddy root certificate: %w", error)
	}

	return 0, nil
}
