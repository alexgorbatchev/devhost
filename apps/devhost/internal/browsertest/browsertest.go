// Package browsertest gives browser tests the Chromium the repository installs and a run directory for its profile.
package browsertest

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/chromedp/chromedp"
)

// locateScript prints the Chromium executable Playwright installed and the source of readContrastRatio, which the
// browser tests and the UI stories share to measure text contrast.
const locateScript = `import { chromium } from "playwright"; import { readContrastRatio } from "../../test-support/readContrastRatio"; console.log(JSON.stringify({path: chromium.executablePath(), contrast: readContrastRatio.toString()}))`

// Browser is the Chromium a browser test drives.
type Browser struct {
	// Path is the Chromium executable that the repository's install workflow downloads.
	Path string
	// Contrast is the source of a function that returns the contrast ratio of an element's text against what is
	// behind it. Call it in the page as `(` + Contrast + `)(element)`.
	Contrast string
}

// Locate returns the repository's Chromium.
func Locate(t testing.TB) Browser {
	t.Helper()

	_, sourcePath, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate the browsertest source")
	}
	command := exec.Command("bun", "-e", locateScript)
	command.Dir = filepath.Join(filepath.Dir(sourcePath), "..", "..", "..", "..", "packages", "devhost-ui")
	// Bun can print notices to stderr, so only stdout holds the JSON.
	var stderr strings.Builder
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		t.Fatalf("locate repository Chromium: %v: %s", err, stderr.String())
	}
	var browser Browser
	if err := json.Unmarshal(output, &browser); err != nil {
		t.Fatalf("parse repository Chromium %q: %v", output, err)
	}
	return browser
}

// AllocatorOptions returns the options that start this Chromium headless with its profile at profilePath.
func (b Browser) AllocatorOptions(profilePath string) []chromedp.ExecAllocatorOption {
	return append(chromedp.DefaultExecAllocatorOptions[:], chromedp.ExecPath(b.Path), chromedp.UserDataDir(profilePath), chromedp.NoSandbox)
}

// RunDirectory returns a new directory for one test run under <os.TempDir()>/devhost-e2e, where browser profiles and
// generated fixtures live outside the checkout, and removes it when the test ends.
func RunDirectory(t testing.TB, prefix string) string {
	t.Helper()

	root := filepath.Join(os.TempDir(), "devhost-e2e")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	directory, err := os.MkdirTemp(root, prefix+"-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(directory); err != nil {
			t.Error(err)
		}
	})
	return directory
}
