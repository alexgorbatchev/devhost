package files

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/chromedp/chromedp"
)

func TestMarkdownSourcePreferenceInBrowser(t *testing.T) {
	chromium := browsertest.Locate(t)
	runDir := browsertest.RunDirectory(t, "files-browser")
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
		allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(filepath.Join(runDir, "profile"))...)
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
				ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](`(`+chromium.Contrast+`)(document.querySelector('`+selector+`'))`))
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
