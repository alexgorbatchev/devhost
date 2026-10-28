package devtools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"sync"
	"testing"

	"github.com/chromedp/chromedp"
)

func assertPagePreviewNavigation(t *testing.T, ctx context.Context) {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	server := startDevSourceControlServer(t, root)
	backend, err := url.Parse(serverURL(server.Port(), "/"))
	if err != nil {
		t.Fatal(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(backend)
	recoveryReady := make(chan struct{})
	worktreesReady := make(chan struct{})
	releaseRecovery := sync.OnceFunc(func() { close(recoveryReady) })
	releaseWorktrees := sync.OnceFunc(func() { close(worktreesReady) })
	// Hold the initial status response so disabled controls are deterministic,
	// rather than relying on a slow CI machine to expose the connection race.
	preview := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(recoveryHeader) == "status" {
			var ready <-chan struct{}
			switch r.URL.Path {
			case pagePreviewPath + "500":
				ready = recoveryReady
			case pagePreviewPath + "worktrees":
				ready = worktreesReady
			}
			if ready != nil {
				select {
				case <-ready:
				case <-r.Context().Done():
					return
				}
			}
		}
		proxy.ServeHTTP(w, r)
	}))
	defer func() {
		releaseRecovery()
		releaseWorktrees()
		preview.Close()
	}()
	previewURL := preview.URL + pagePreviewPath
	t.Log("page preview: recovery navigation and connection readiness")
	if err := chromedp.Do(ctx,
		chromedp.Navigate(previewURL),
		chromedp.Click(chromedp.CSS(`a[href="500"]`)),
		chromedp.WaitVisible(chromedp.CSS("#restart:disabled")),
	); err != nil {
		t.Fatalf("preview recovery navigation/initially disabled restart: %v", err)
	}
	releaseRecovery()
	if err := chromedp.Do(ctx,
		chromedp.WaitVisible(chromedp.CSS("#restart:not(:disabled)")),
		chromedp.Click(chromedp.CSS("#restart:not(:disabled)")),
		chromedp.WaitVisible(chromedp.CSS("#error")),
	); err != nil {
		t.Fatalf("preview connected restart: %v", err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector('#error').textContent.includes('Preview only') && location.pathname.endsWith('/500')`)); err != nil {
		t.Fatalf("preview restart rejection: %v", err)
	}
	t.Log("page preview: not-found navigation and stylesheet")
	if err := chromedp.Do(ctx, chromedp.Navigate(previewURL+"route-not-found"), chromedp.WaitVisible(chromedp.CSS(`a[href$="files/"]`))); err != nil {
		t.Fatalf("preview not-found navigation: %v", err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/pages/status.css') && sheet.cssRules.length > 0)`)); err != nil {
		t.Fatalf("preview stylesheet: %v", err)
	}
	t.Log("page preview: file navigation and source toggle")
	if err := chromedp.Do(ctx,
		chromedp.Click(chromedp.CSS(`a[href$="files/"]`)),
		chromedp.Click(chromedp.CSS(`a[href="notes.md"]`)),
		chromedp.WaitVisible(chromedp.CSS("#rendered h1")),
		chromedp.Click(chromedp.CSS("#toggle-source")),
		chromedp.WaitVisible(chromedp.CSS("#source")),
	); err != nil {
		t.Fatalf("preview file navigation/source toggle: %v", err)
	}
	t.Log("page preview: worktree navigation and connection readiness")
	if err := chromedp.Do(ctx,
		chromedp.Navigate(previewURL+"worktrees"),
		chromedp.WaitVisible(chromedp.CSS(`button[type="submit"]:disabled`)),
	); err != nil {
		t.Fatalf("preview worktree navigation/initially disabled control: %v", err)
	}
	releaseWorktrees()
	if err := chromedp.Do(ctx,
		chromedp.WaitVisible(chromedp.CSS(`button[type="submit"]:not(:disabled)`)),
		chromedp.Click(chromedp.CSS(`button[type="submit"]:not(:disabled)`)),
		chromedp.WaitVisible(chromedp.CSS("#error")),
	); err != nil {
		t.Fatalf("preview connected worktree switch: %v", err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector('#error').textContent.includes('Preview only') && !document.querySelector('fieldset').disabled`)); err != nil {
		t.Fatalf("preview worktree rejection: %v", err)
	}
}
