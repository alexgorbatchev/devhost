package main

import (
	"fmt"
	"os"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/app"
)

func main() {
	cwd := os.Getenv("DEVHOST_SHIM_CWD")
	if cwd == "" {
		resolvedCwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "failed: read current working directory: %v\n", err)
			os.Exit(1)
		}
		cwd = resolvedCwd
	}

	os.Exit(app.Run(os.Args[1:], cwd, os.Stdout, os.Stderr))
}
