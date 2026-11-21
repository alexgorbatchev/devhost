package files

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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
		if err := os.WriteFile(filepath.Join(dir, name), []byte("---\ncreated_on: 2026-11-15T00:00:00Z\nstatus: active\n---\n\n# Heading\n\n**bold** <script>window.pwned = true</script>\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- Bullet\n\n1. Number\n\n- [x] Done\n\n~~old~~\n\n[bad](javascript:alert(1))"), 0o600); err != nil {
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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, r)
		w.Header().Set("Content-Type", response.Header().Get("Content-Type"))
		w.WriteHeader(response.Code)
		// Sample the DOM on both sides of the inline bootstrap. These probes
		// catch a visible fallback or an async mount without paint timing races.
		body := strings.Replace(response.Body.String(), `<script id="devhost-status-data"`,
			`<script>window.markdownFallbackVisible = Boolean(document.querySelector('#devhost-status').innerText.trim())</script><script id="devhost-status-data"`, 1)
		body = strings.Replace(body, "</body>", `<script>
			const expected = localStorage.getItem('devhost.files.markdown.source') === 'true' ? '#source' : '#rendered h1';
			window.markdownMounted = Boolean(document.querySelector(expected)?.getClientRects().length);
		</script></body>`, 1)
		if _, err := w.Write([]byte(body)); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	visit := func(restarted bool) {
		t.Helper()
		allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(t, filepath.Join(runDir, "profile"))...)
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
		assertInitialView := func() {
			t.Helper()
			ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`window.markdownFallbackVisible === false && window.markdownMounted === true`))
			if err != nil || !ok {
				t.Fatalf("Markdown must mount the selected view without a visible fallback: %v", err)
			}
		}
		assertInitialView()
		if !restarted {
			if err := chromedp.Do(ctx, chromedp.WaitVisible(chromedp.CSS("#rendered h1"))); err != nil {
				t.Fatal(err)
			}
			// The leading front matter renders as a key/value table, before the document's only heading.
			safe, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector('#rendered').firstElementChild.matches('table[aria-label="Front matter"]') && document.querySelector('#rendered thead th').textContent === 'created_on' && document.querySelector('#rendered tbody td:last-child').textContent === 'active' && document.querySelectorAll('#rendered h1, #rendered h2').length === 1 && document.querySelector('#rendered table') !== null && document.querySelector('#rendered input[type=checkbox]').checked && document.querySelector('#rendered del').textContent === 'old' && document.querySelector('#rendered script') === null && !document.querySelector('#rendered a').getAttribute('href') && window.pwned === undefined`))
			if err != nil || !safe {
				t.Fatalf("Markdown rendering or sanitization failed: %v", err)
			}
			markers, err := chromedp.Run(ctx, chromedp.Evaluate[string](`Array.from(document.querySelectorAll('#rendered li'), item => getComputedStyle(item).listStyleType).join(', ')`))
			if err != nil || markers != "disc, decimal, none" {
				t.Fatalf("Markdown list markers = %q, want bullets, numbers, and checkboxes: %v", markers, err)
			}
			if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("#toggle-source"))); err != nil {
				t.Fatal(err)
			}
		}
		assertSource := func() {
			t.Helper()
			if err := chromedp.Do(ctx, chromedp.WaitVisible(chromedp.CSS("#source"))); err != nil {
				t.Fatal(err)
			}
			ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.querySelector('#source').textContent.includes('status: active') && document.querySelector('#source').textContent.includes('**bold**') && document.querySelector('#toggle-source').textContent === 'Show rendered' && !document.querySelector('#toggle-source').hasAttribute('aria-pressed') && getComputedStyle(document.querySelector('#rendered')).display === 'none' && window.pwned === undefined`))
			if err != nil || !ok {
				t.Fatalf("source view is incorrect: %v %v", ok, err)
			}
			for _, selector := range []string{"#source", "#toggle-source", `header [aria-current="page"]`} {
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
		assertInitialView()
		assertSource()
		if err := chromedp.Do(ctx, chromedp.Navigate(server.URL+"/second.md")); err != nil {
			t.Fatal(err)
		}
		assertInitialView()
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
