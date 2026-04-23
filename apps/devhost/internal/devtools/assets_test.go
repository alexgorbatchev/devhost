package devtools

import (
	"strings"
	"testing"
)

func TestBundledDevtoolsAssetsAreEmbedded(t *testing.T) {
	t.Parallel()

	devtoolsScript, error := readBundledDevtoolsScript()
	if error != nil {
		t.Fatalf("readBundledDevtoolsScript() error = %v", error)
	}
	if !strings.Contains(devtoolsScript, "__DEVHOST__") {
		t.Fatalf("readBundledDevtoolsScript() did not include the bundled devtools runtime")
	}

	xtermStylesheet, error := readXtermStylesheet()
	if error != nil {
		t.Fatalf("readXtermStylesheet() error = %v", error)
	}
	if !strings.Contains(xtermStylesheet, ".xterm") {
		t.Fatalf("readXtermStylesheet() did not include xterm styles")
	}
}
