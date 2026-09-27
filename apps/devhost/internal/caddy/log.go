package caddy

import (
	"fmt"
	"io"
)

func logInfo(logWriter io.Writer, message string) error {
	_, err := fmt.Fprintf(logWriter, "[devhost] %s\n", message)
	return err
}
