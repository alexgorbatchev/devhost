package devtools

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The bundle's CSS minifier rewrites numbers, so layer order is checked on the shipped script rather than the source
// stylesheet: layers that collapse to one z-index fall back to DOM order, and a later-rendered surface such as the
// minimap then paints over a fullscreen terminal.
func TestBundledDevtoolsLayersStackInOrder(t *testing.T) {
	t.Parallel()

	devtoolsScript, error := readBundledDevtoolsScript()
	if error != nil {
		t.Fatalf("readBundledDevtoolsScript() error = %v", error)
	}

	layersBottomToTop := []string{"overlay", "dock", "popover", "modal", "edge"}
	previousLayer := ""
	previousValue := int64(-1)
	for _, layer := range layersBottomToTop {
		match := regexp.MustCompile(`--devhost-z-` + layer + `:(\d+)`).FindStringSubmatch(devtoolsScript)
		if match == nil {
			t.Fatalf("bundled stylesheet does not declare --devhost-z-%s", layer)
		}
		value, error := strconv.ParseInt(match[1], 10, 64)
		if error != nil {
			t.Fatalf("parse --devhost-z-%s value %q: %v", layer, match[1], error)
		}
		if value <= previousValue {
			t.Fatalf("--devhost-z-%s = %d, want above --devhost-z-%s = %d", layer, value, previousLayer, previousValue)
		}
		previousLayer = layer
		previousValue = value
	}
}

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
