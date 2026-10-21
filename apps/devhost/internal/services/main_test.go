package services

import (
	"fmt"
	"os"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/testenv"
)

func TestMain(m *testing.M) {
	if err := testenv.UsePhysicalTempDir(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
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
