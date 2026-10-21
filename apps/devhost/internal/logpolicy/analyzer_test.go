package logpolicy

import (
	"golang.org/x/tools/go/analysis/analysistest"
	"testing"
)

func TestLoggingPolicy(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), Analyzer, "output")
}
