package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"
)

func TestRecoveryDesignInBrowser(t *testing.T) {
	chromium := browsertest.Locate(t)
	tokens, err := os.ReadFile("../../../../packages/design/tokens.css")
	if err != nil {
		t.Fatal(err)
	}
	tokenJSON, err := json.Marshal(string(tokens))
	if err != nil {
		t.Fatal(err)
	}
	runDir := browsertest.RunDirectory(t, "recovery-design")
	allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(filepath.Join(runDir, "profile"))...)
	defer stop()
	browser, closeBrowser := chromedp.NewContext(allocator)
	defer closeBrowser()
	ctx, cancel := context.WithTimeout(browser, 45*time.Second)
	defer cancel()
	state := RecoveryState{Stack: "project", Service: "web", Title: "web could not load", Message: strings.Repeat("compiler-error/", 30), Logs: []string{strings.Repeat("long-output ", 100)}, Repositories: []WorktreeRepository{{ID: "repo", Name: "project", SelectedPath: "/main", Worktrees: []Worktree{{Path: strings.Repeat("/checkout", 30), Branch: "feature", Available: true}}}}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(recoveryHeader) == "status" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(state)
			return
		}
		serveRecoveryPage(w, r, state, http.StatusInternalServerError, false)
	}))
	defer server.Close()
	for _, theme := range []string{"dark", "light"} {
		t.Run(theme, func(t *testing.T) {
			if _, err := chromedp.Call(ctx, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: theme}}}); err != nil {
				t.Fatal(err)
			}
			if err := chromedp.Do(ctx, chromedp.EmulateViewport(320, 740), chromedp.Navigate(server.URL), chromedp.WaitVisible(chromedp.CSS("#title"))); err != nil {
				t.Fatal(err)
			}
			fits, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`document.documentElement.scrollWidth <= innerWidth`))
			if err != nil || !fits {
				t.Fatalf("recovery page overflows a narrow viewport: fits=%v, err=%v", fits, err)
			}
			matches, err := chromedp.Run(ctx, chromedp.Evaluate[bool](fmt.Sprintf(`(() => {
				const host = document.createElement('div');
				host.dataset.theme = %q;
				const root = host.attachShadow({mode:'open'});
				root.innerHTML = '<style>' + %s + ':host { background: var(--dh-surface); color: var(--dh-fg) }</style>';
				document.body.append(host);
				const matches = getComputedStyle(document.body).backgroundColor === getComputedStyle(host).backgroundColor
					&& getComputedStyle(document.body).color === getComputedStyle(host).color;
				host.remove();
				return matches;
			})()`, theme, tokenJSON)))
			if err != nil || !matches {
				t.Errorf("page does not follow the shared %s design palette: %v", theme, err)
			}
			for _, selector := range []string{"#title", "#message", "#logs", "summary", "legend"} {
				ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](`(`+chromium.Contrast+`)(document.querySelector('`+selector+`'))`))
				if err != nil || ratio < 4.5 {
					t.Errorf("%s contrast=%v, err=%v; want at least 4.5", selector, ratio, err)
				}
			}
		})
	}
	// A preference change also updates an already open document.
	if _, err := chromedp.Call(ctx, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "dark"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.documentElement.dataset.theme === 'dark'`)); err != nil {
		t.Fatal(err)
	}
	assertPagePreviewNavigation(t, ctx)
}
