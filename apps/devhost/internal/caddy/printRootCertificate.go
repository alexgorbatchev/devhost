package caddy

import (
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func PrintManagedCaddyRootCertificate(stdout io.Writer, paths Paths) (int, error) {
	certificate, err := os.ReadFile(paths.RootCertificatePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, fmt.Errorf("Managed Caddy root certificate not found at %s. Run 'devhost caddy start' first.", paths.RootCertificatePath)
		}

		return 0, err
	}

	if err := cliout.WriteData(stdout, certificate); err != nil {
		return 0, fmt.Errorf("write managed caddy root certificate: %w", err)
	}

	return 0, nil
}
