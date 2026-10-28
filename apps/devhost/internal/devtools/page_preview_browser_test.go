package devtools

import (
	"context"
	"path/filepath"
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
	url := serverURL(server.Port(), pagePreviewPath)
	t.Log("page preview: recovery navigation and restart rejection")
	if err := chromedp.Do(ctx,
		chromedp.Navigate(url),
		chromedp.Click(chromedp.CSS(`a[href="500"]`)),
		chromedp.WaitVisible(chromedp.CSS("#restart")),
		chromedp.Click(chromedp.CSS("#restart")),
		chromedp.WaitVisible(chromedp.CSS("#error")),
	); err != nil {
		t.Fatalf("preview recovery navigation/restart: %v", err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector('#error').textContent.includes('Preview only') && location.pathname.endsWith('/500')`)); err != nil {
		t.Fatalf("preview restart rejection: %v", err)
	}
	t.Log("page preview: not-found navigation and stylesheet")
	if err := chromedp.Do(ctx, chromedp.Navigate(url+"route-not-found"), chromedp.WaitVisible(chromedp.CSS(`a[href$="files/"]`))); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`Array.from(document.styleSheets).some(sheet => sheet.href?.endsWith('/pages/status.css') && sheet.cssRules.length > 0)`)); err != nil {
		t.Fatal(err)
	}
	t.Log("page preview: file navigation, source toggle and worktree rejection")
	if err := chromedp.Do(ctx,
		chromedp.Click(chromedp.CSS(`a[href$="files/"]`)),
		chromedp.Click(chromedp.CSS(`a[href="notes.md"]`)),
		chromedp.WaitVisible(chromedp.CSS("#rendered h1")),
		chromedp.Click(chromedp.CSS("#toggle-source")),
		chromedp.WaitVisible(chromedp.CSS("#source")),
	); err != nil {
		t.Fatalf("preview file navigation/source toggle: %v", err)
	}
	t.Log("page preview: worktree navigation and rejection")
	if err := chromedp.Do(ctx,
		chromedp.Navigate(url+"worktrees"),
		chromedp.Click(chromedp.CSS(`button[type="submit"]`)),
		chromedp.WaitVisible(chromedp.CSS("#error")),
	); err != nil {
		t.Fatalf("preview worktree navigation/rejection: %v", err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.querySelector('#error').textContent.includes('Preview only') && !document.querySelector('fieldset').disabled`)); err != nil {
		t.Fatal(err)
	}
}
