package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/browsertest"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/chromedp"
)

func TestRecoveryPageOpensAndStopsWorktreeOwner(t *testing.T) {
	chromium := browsertest.Locate(t)
	runDir := browsertest.RunDirectory(t, "recovery-owner")
	allocator, stop := chromedp.NewExecAllocator(context.Background(), chromium.AllocatorOptions(filepath.Join(runDir, "profile"))...)
	defer stop()
	browser, closeBrowser := chromedp.NewContext(allocator)
	defer closeBrowser()
	ctx, cancel := context.WithTimeout(browser, 30*time.Second)
	defer cancel()
	var mu sync.Mutex
	stopped := false
	discovered := false
	attempts := 0
	readState := func() RecoveryState {
		mu.Lock()
		defer mu.Unlock()
		entry := Worktree{Path: "/feature", Branch: "feature", Available: stopped || !discovered}
		if discovered && !stopped {
			entry.Owners = []WorktreeOwner{{ID: "owner-instance", Name: "storybook", PID: 123, ManifestPath: "/feature/devhost.toml", URLs: []string{"https://storybook.localhost/"}}}
		}
		return RecoveryState{Phase: "failed", Title: "App failed", Repositories: []WorktreeRepository{{ID: "repo", Name: "shop", SelectedPath: "/main", Worktrees: []Worktree{{Path: "/main", Branch: "main", Available: true}, entry}}}}
	}
	control := &ControlServer{
		refreshWorktrees: func() error { mu.Lock(); discovered = true; mu.Unlock(); return nil },
		getHealth:        func() (HealthResponse, error) { return HealthResponse{Repositories: readState().Repositories}, nil },
		switchWorktree:   func(string, string) error { return fmt.Errorf("unexpected switch") },
		stopWorktreeOwner: func(_ context.Context, id, path, owner string) error {
			mu.Lock()
			defer mu.Unlock()
			if id != "repo" || path != "/feature" || owner != "owner-instance" {
				return fmt.Errorf("wrong stop target")
			}
			attempts++
			if attempts == 1 {
				return fmt.Errorf("Stack ownership changed; refresh worktrees")
			}
			stopped = true
			return nil
		},
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(recoveryHeader) == "worktrees" {
			control.RecoveryWorktrees().ServeHTTP(w, r)
			return
		}
		state := readState()
		if r.Header.Get(recoveryHeader) == "status" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(state)
			return
		}
		serveRecoveryPage(w, r, state, http.StatusInternalServerError, false)
	}))
	defer server.Close()
	if err := chromedp.Do(ctx, chromedp.Navigate(server.URL), chromedp.WaitVisible(chromedp.CSS("button[data-stop-owner]"))); err != nil {
		t.Fatal(err)
	}
	valid, err := chromedp.Run(ctx, chromedp.Evaluate[bool](`(() => {
		const link = document.querySelector('a[href="https://storybook.localhost/"]');
		return link?.target === '_blank' && document.querySelector('option[value="/feature"]').disabled;
	})()`))
	if err != nil || !valid {
		t.Fatalf("occupied checkout links or selection: %v, %v", valid, err)
	}
	for _, theme := range []string{"dark", "light"} {
		if _, err := chromedp.Call(ctx, emulation.SetEmulatedMedia, emulation.SetEmulatedMediaParams{Features: []*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: theme}}}); err != nil {
			t.Fatal(err)
		}
		if _, err := chromedp.Run(ctx, chromedp.Poll[bool](fmt.Sprintf(`document.documentElement.dataset.theme === %q`, theme))); err != nil {
			t.Fatal(err)
		}
		ratio, err := chromedp.Run(ctx, chromedp.Evaluate[float64](`(`+chromium.Contrast+`)(document.querySelector('a[href="https://storybook.localhost/"]'))`))
		if err != nil || ratio < 4.5 {
			t.Fatalf("open stack link contrast (%s) = %v, %v", theme, ratio, err)
		}
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`!document.querySelector('button[data-stop-owner]').disabled`)); err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("button[data-stop-owner]"))); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`document.getElementById('error').textContent.trim() === 'Stack ownership changed; refresh worktrees'`)); err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.Click(chromedp.CSS("button[data-stop-owner]"))); err != nil {
		t.Fatal(err)
	}
	if err := chromedp.Do(ctx, chromedp.WaitNotPresent(chromedp.CSS("button[data-stop-owner]")), chromedp.WaitVisible(chromedp.CSS("#worktrees"))); err != nil {
		t.Fatal(err)
	}
	if _, err := chromedp.Run(ctx, chromedp.Poll[bool](`!document.querySelector('option[value="/feature"]').disabled`)); err != nil {
		t.Fatal(err)
	}
}
