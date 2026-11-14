package app

import (
	"fmt"
	"os"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/testenv"
)

func TestMain(m *testing.M) {
	// Native detached/restart tests re-exec this binary with actual CLI arguments.
	if os.Getenv("DEVHOST_TEST_CLI") == "1" && len(os.Args) > 1 && (os.Args[1] == "start" || os.Args[1] == "stop" || os.Args[1] == "stack") {
		cwd, err := os.Getwd()
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(Run(os.Args[1:], cwd, os.Stdout, os.Stderr))
	}

	removeHome, err := testenv.IsolateHome()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	removeHome()
	os.Exit(code)
}
