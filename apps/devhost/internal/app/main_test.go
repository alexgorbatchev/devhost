package app

import (
	"fmt"
	"os"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/testenv"
)

func TestMain(m *testing.M) {
	removeHome, err := testenv.IsolateHome()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	code := m.Run()
	removeHome()
	os.Exit(code)
}
