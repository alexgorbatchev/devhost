package files

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/chromedp/chromedp"
)

func TestBreadcrumbNavigationInBrowser(t *testing.T) {
	chromium := browsertest.Locate(t)
	runDir := browsertest.RunDirectory(t, "breadcrumbs")
	allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(filepath.Join(runDir, "profile"))...)
	defer stop()
	browser, closeBrowser := chromedp.NewContext(allocator)
	defer closeBrowser()
	ctx, cancel := context.WithTimeout(browser, time.Minute)
	defer cancel()
	defer func() {
		if err := chromedp.Cancel(browser); err != nil {
			t.Error(err)
		}
	}()

	longName := strings.Repeat("long", 50) + ".md"
	for _, tt := range []struct {
		name, file, target string
		crumbs             []listingEntry
	}{
		{"root listing", "notes.md", "/", []listingEntry{{Name: "devhost"}}},
		{"root index", "index.md", "/", []listingEntry{{Name: "devhost"}}},
		{"explicit index", "index.md", "/index.md", []listingEntry{{"devhost", "/"}, {Name: "index.md"}}},
		{"nested listing", "docs/deeper/notes.md", "/docs/deeper/", []listingEntry{{"devhost", "/"}, {"docs", "/docs/"}, {Name: "deeper"}}},
		{"nested index", "docs/deeper/index.md", "/docs/deeper/", []listingEntry{{"devhost", "/"}, {"docs", "/docs/"}, {Name: "deeper"}}},
		{"nested markdown", "docs/deeper/notes.md", "/docs/deeper/notes.md", []listingEntry{{"devhost", "/"}, {"docs", "/docs/"}, {"deeper", "/docs/deeper/"}, {Name: "notes.md"}}},
		{"escaped names", "a #?% <tag> é/notes.md", "/a%20%23%3F%25%20%3Ctag%3E%20%C3%A9/notes.md?ignored=true", []listingEntry{{"devhost", "/"}, {"a #?% <tag> é", "/a%20%23%3F%25%20%3Ctag%3E%20%C3%A9/"}, {Name: "notes.md"}}},
		{"narrow viewport", "docs/" + longName, "/docs/" + longName, []listingEntry{{"devhost", "/"}, {"docs", "/docs/"}, {Name: longName}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			dir := filepath.Join(runDir, tt.name)
			file := filepath.Join(dir, tt.file)
			if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(file, []byte("# Notes"), 0o600); err != nil {
				t.Fatal(err)
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
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(375, 800), chromedp.Navigate(server.URL+tt.target), chromedp.WaitVisible(chromedp.CSS(`nav[aria-label="Breadcrumb"]`))); err != nil {
				t.Fatal(err)
			}
			got, err := chromedp.Run(ctx, chromedp.Evaluate[[]listingEntry](`Array.from(document.querySelectorAll('nav[aria-label="Breadcrumb"] li'), li => {
                const crumb = li.querySelector('a, [aria-current]');
                return {Name: crumb.textContent, Href: crumb.getAttribute('href') || ''};
            })`))
			if err != nil || !reflect.DeepEqual(got, tt.crumbs) {
				t.Fatalf("breadcrumbs = %+v, err = %v; want %+v", got, err, tt.crumbs)
			}
			ok, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(() => {
                const nav = document.querySelector('nav[aria-label="Breadcrumb"]');
                const current = nav.querySelectorAll('[aria-current="page"]');
                return current.length === 1 && current[0].closest('li') === nav.querySelector('li:last-child') &&
                    !current[0].hasAttribute('href') && nav.querySelector('ol') !== null &&
                    nav.querySelector('tag') === null && document.documentElement.scrollWidth <= innerWidth;
            })()`))
			if err != nil || !ok {
				t.Fatalf("breadcrumb semantics, escaping, or layout failed: %v, %v", ok, err)
			}
			for i := len(tt.crumbs) - 2; i >= 0; i-- {
				if err := chromedp.Do(ctx, chromedp.Navigate(server.URL+tt.target), chromedp.Click(chromedp.CSS(`nav[aria-label="Breadcrumb"] li:nth-child(`+strconv.Itoa(i+1)+`) a`)), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
					t.Fatal(err)
				}
				location, err := chromedp.Run(ctx, chromedp.Evaluate[string](`location.pathname + location.search`))
				if err != nil || location != tt.crumbs[i].Href {
					t.Fatalf("ancestor navigation = %q, err = %v; want %q", location, err, tt.crumbs[i].Href)
				}
			}
		})
	}
}
