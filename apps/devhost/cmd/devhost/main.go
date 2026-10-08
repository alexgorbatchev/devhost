package main

import (
	"fmt"
	"os"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/app"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		cliout.WriteFailure(os.Stderr, fmt.Errorf("read current working directory: %w", err))
		os.Exit(1)
	}

	os.Exit(app.Run(os.Args[1:], cwd, os.Stdout, os.Stderr))
}
