package devtools

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The bundle's CSS minifier rewrites numbers, so layer order is checked on the shipped script rather than the source
// stylesheet: layers that collapse to one z-index fall back to DOM order, and a later-rendered surface such as the
// minimap then paints over a terminal window.
//
// Bottom to top: page highlights, annotation drafts, the toolbar, the minimap, terminal windows.
func TestBundledDevtoolsLayersStackInOrder(t *testing.T) {
	t.Parallel()

	scriptBytes, err := bundledAssets.ReadFile("dist/devtools.js")
	if err != nil {
		t.Fatalf("read bundled script: %v", err)
	}
	devtoolsScript := string(scriptBytes)

	layersBottomToTop := []string{"overlay", "popover", "dock", "edge", "modal"}
	previousLayer := ""
	previousValue := int64(-1)
	for _, layer := range layersBottomToTop {
		match := regexp.MustCompile(`--devhost-z-` + layer + `:(\d+)`).FindStringSubmatch(devtoolsScript)
		if match == nil {
			t.Fatalf("bundled stylesheet does not declare --devhost-z-%s", layer)
		}
		value, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil {
			t.Fatalf("parse --devhost-z-%s value %q: %v", layer, match[1], err)
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

	scriptBytes, err := bundledAssets.ReadFile("dist/devtools.js")
	if err != nil {
		t.Fatalf("read bundled script: %v", err)
	}
	if !strings.Contains(string(scriptBytes), "__DEVHOST__") {
		t.Fatal("embedded script did not include the bundled devtools runtime")
	}

	stylesheetBytes, err := bundledAssets.ReadFile("dist/xterm.css")
	if err != nil {
		t.Fatalf("read terminal stylesheet: %v", err)
	}
	if !strings.Contains(string(stylesheetBytes), ".xterm") {
		t.Fatal("embedded stylesheet did not include xterm styles")
	}
}
