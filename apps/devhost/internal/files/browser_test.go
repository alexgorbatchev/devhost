package files

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chromedp/chromedp"
)

func TestMarkdownSourcePreferenceInBrowser(t *testing.T) {
	// Use the browser installed by the repository's normal install workflow.
	command := exec.Command("bun", "-e", `import { chromium } from "playwright"; import { readContrastRatio } from "../../test-support/readContrastRatio"; console.log(JSON.stringify({path: chromium.executablePath(), contrast: readContrastRatio.toString()}))`)
	command.Dir = "../../../../packages/devhost-ui"
	// Bun can print notices to stderr, so only stdout holds the JSON.
	var stderr strings.Builder
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		t.Fatalf("locate repository Chromium: %v: %s", err, stderr.String())
	}
	var tools struct{ Path, Contrast string }
	if err := json.Unmarshal(output, &tools); err != nil {
		t.Fatal(err)
	}
	runRoot := filepath.Join(os.TempDir(), "devhost-e2e")
	if err := os.MkdirAll(runRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	runDir, err := os.MkdirTemp(runRoot, "files-browser-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(runDir); err != nil {
			t.Error(err)
		}
	})
	dir := filepath.Join(runDir, "content")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"first.md", "second.md"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("# Heading\n\n**bold** <script>window.pwned = true</script>"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	h, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Close(); err != nil {
			t.Error(err)
		}
	})
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	visit := func(restarted bool) {
		t.Helper()
		opts := append(chromedp.DefaultExecAllocatorOptions[:], chromedp.ExecPath(tools.Path), chromedp.UserDataDir(filepath.Join(runDir, "profile")), chromedp.NoSandbox)
		allocator, stop := chromedp.NewExecAllocator(context.Background(), opts...)
		defer stop()
		browser, closeBrowser := chromedp.NewContext(allocator)
		defer closeBrowser()
		ctx, cancel := context.WithTimeout(browser, 30*time.Second)
		defer cancel()
		defer func() {
			if err := chromedp.Cancel(browser); err != nil {
				t.Error(err)
			}
		}()
		if err := chromedp.Do(ctx, chromedp.Navigate(server.URL+"/first.md"), chromedp.WaitVisible(chromedp.CSS("#toggle-source"))); err != nil {
			t.Fatal(err)
		}
		if !restarted {
			if err := chromedp.Do(ctx, chromedp.WaitVisible(chromedp.CSS("#rendered h1")), chromedp.Click(chromedp.CSS("#toggle-source"))); err != nil {
				t.Fatal(err)
			}
		}
		assertSource := func() {
			t.Helper()
			if err := chromedp.Do(ctx, chromedp.WaitVisible(chromedp.CSS("#source"))); err != nil {
				t.Fatal(err)
			}
			ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector('#source').textContent.includes('**bold**') && document.querySelector('#toggle-source').textContent === 'Show rendered' && !document.querySelector('#toggle-source').hasAttribute('aria-pressed') && getComputedStyle(document.querySelector('#rendered')).display === 'none' && window.pwned === undefined`))
			if err != nil || !ok {
				t.Fatalf("source view is incorrect: %v %v", ok, err)
			}
			for _, selector := range []string{"#source", "#toggle-source", "header span"} {
				ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](`(`+tools.Contrast+`)(document.querySelector('`+selector+`'))`))
				if err != nil || ratio < 4.5 {
					t.Errorf("%s contrast=%v, err=%v; want at least 4.5", selector, ratio, err)
				}
			}
		}
		assertSource()
		if err := chromedp.Do(ctx, chromedp.Reload()); err != nil {
			t.Fatal(err)
		}
		assertSource()
		if err := chromedp.Do(ctx, chromedp.Navigate(server.URL+"/second.md")); err != nil {
			t.Fatal(err)
		}
		assertSource()
		if restarted {
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("#toggle-source")), chromedp.Reload(), chromedp.WaitVisible(chromedp.CSS("#rendered h1"))); err != nil {
				t.Fatal(err)
			}
		}
	}
	visit(false)
	visit(true)
}
