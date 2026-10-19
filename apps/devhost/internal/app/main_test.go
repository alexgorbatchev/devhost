package app

import (
	"fmt"
	"os"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/testenv"
)

func TestMain(m *testing.M) {
	removeConfig, err := testenv.IsolateDevhostConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	removeConfig()
	os.Exit(code)
}
