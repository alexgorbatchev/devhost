package main

import (
	"fmt"
	"os"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/app"
)

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed: read current working directory: %v\n", err)
		os.Exit(1)
	}

	os.Exit(app.Run(os.Args[1:], cwd, os.Stdout, os.Stderr))
}
