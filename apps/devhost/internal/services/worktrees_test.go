package services

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func TestWorktreeSelectionGroupsServicesAndSurvivesRestart(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	state := t.TempDir()
	w, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	groups := w.snapshot()
	if len(groups) != 1 || len(groups[0].ServiceNames) != 2 || groups[0].SelectedPath != root {
		t.Fatalf("initial repositories = %#v", groups)
	}
	next, err := w.prepare(groups[0].ID, linked, m)
	if err != nil {
		t.Fatal(err)
	}
	if next.Services["web"].Cwd != filepath.Join(linked, "web") || next.Services["api"].Cwd != filepath.Join(linked, "api") {
		t.Fatalf("effective directories = %#v", next.Services)
	}
	if m.Services["web"].Cwd != filepath.Join(root, "web") {
		t.Fatal("configured manifest was mutated")
	}
	w.finish(groups[0].ID, os.ErrPermission)
	if w.snapshot()[0].SelectedPath != linked || w.snapshot()[0].RunningPath != "" {
		t.Fatal("failed start lost selection or claimed a running checkout")
	}
	restored, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	initial, blocked := restored.restore(m)
	if len(blocked) != 0 || initial.Services["api"].Cwd != filepath.Join(linked, "api") {
		t.Fatalf("restore = %#v, blocked = %#v", initial.Services, blocked)
	}
	other := m
	other.ManifestPath = filepath.Join(root, "other.toml")
	independent, err := newStackWorktrees(other, state)
	if err != nil {
		t.Fatal(err)
	}
	if independent.snapshot()[0].SelectedPath != root {
		t.Fatal("selection leaked to a different stack")
	}
}

func TestWorktreeHealthPreservesIndividualAndGroupRestartState(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	w, err := newStackWorktrees(m, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	child := &startedService{service: m.Services["web"]}
	runtime := &stackRuntime{manifest: &m, worktrees: w, started: []*startedService{child}}
	child.setRestarting(true)
	health, err := runtime.health()
	if err != nil || !health.Services[1].Restarting || health.Services[0].Restarting {
		t.Fatalf("individual restart state = %#v, %v", health.Services, err)
	}
	child.setRestarting(false)
	if _, err := w.prepare(w.snapshot()[0].ID, linked, m); err != nil {
		t.Fatal(err)
	}
	health, err = runtime.health()
	if err != nil || !health.Services[0].Restarting || !health.Services[1].Restarting {
		t.Fatalf("group restart state = %#v, %v", health.Services, err)
	}
	w.finish(w.snapshot()[0].ID, nil)
	health, err = runtime.health()
	if err != nil || health.Services[0].Restarting || health.Services[1].Restarting {
		t.Fatalf("completed restart state = %#v, %v", health.Services, err)
	}
}

func TestWorktreeValidationDoesNotChangeSelection(t *testing.T) {
	for _, kind := range []string{"missing directory", "foreign checkout", "symlink escape", "external service"} {
		t.Run(kind, func(t *testing.T) {
			root, linked := createWorktreeRepository(t)
			m := worktreeTestManifest(root)
			switch kind {
			case "missing directory":
				if err := os.RemoveAll(filepath.Join(linked, "api")); err != nil {
					t.Fatal(err)
				}
			case "foreign checkout":
				linked, _ = createWorktreeRepository(t)
			case "symlink escape":
				if err := os.RemoveAll(filepath.Join(linked, "api")); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(filepath.Join(root, "api"), filepath.Join(linked, "api")); err != nil {
					t.Fatal(err)
				}
			case "external service":
				s := m.Services["api"]
				s.Managed, s.Command = false, nil
				m.Services["api"] = s
			}
			w, err := newStackWorktrees(m, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			id := w.snapshot()[0].ID
			if _, err := w.prepare(id, linked, m); err == nil {
				t.Fatal("invalid selection accepted")
			}
			if w.snapshot()[0].SelectedPath != root || w.snapshot()[0].Switching {
				t.Fatal("rejected switch changed selection")
			}
		})
	}
}

func TestWorktreeSelectionKeepsOtherRepositoriesIndependent(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	otherRoot, _ := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	m.Services["docs"] = ResolvedService{Name: "docs", Cwd: filepath.Join(otherRoot, "web"), Managed: true, Command: []string{"service"}}
	m.ServiceOrder = append(m.ServiceOrder, "docs")
	state := t.TempDir()
	w, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	groups := w.snapshot()
	if len(groups) != 2 {
		t.Fatalf("groups = %#v", groups)
	}
	next, err := w.prepare(groups[0].ID, linked, m)
	if err != nil {
		t.Fatal(err)
	}
	if next.Services["docs"].Cwd != filepath.Join(otherRoot, "web") || w.snapshot()[1].SelectedPath != otherRoot {
		t.Fatal("switch changed another repository")
	}
	restored, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	initial, blocked := restored.restore(m)
	if len(blocked) != 0 || initial.Services["docs"].Cwd != filepath.Join(otherRoot, "web") || initial.Services["api"].Cwd != filepath.Join(linked, "api") {
		t.Fatalf("independent restart = %#v, %#v", initial.Services, blocked)
	}
}

func TestMissingSavedWorktreeBlocksStartupWithoutFallback(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	state := t.TempDir()
	w, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.prepare(w.snapshot()[0].ID, linked, m); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(linked); err != nil {
		t.Fatal(err)
	}
	restored, err := newStackWorktrees(m, state)
	if err != nil {
		t.Fatal(err)
	}
	_, blocked := restored.restore(m)
	if len(blocked) != 2 || restored.snapshot()[0].Error == "" || restored.snapshot()[0].SelectedPath != linked {
		t.Fatalf("missing saved checkout not recoverable: %#v, %#v", restored.snapshot(), blocked)
	}
	if _, err := restored.prepare(restored.snapshot()[0].ID, root, m); err != nil {
		t.Fatalf("return to configured checkout: %v", err)
	}
}

func TestWorktreeDiscoveryHandlesDetachedAndLockedPaths(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	runWorktreeGit(t, root, "worktree", "lock", "--reason", "keep this checkout", linked)
	detached := filepath.Join(t.TempDir(), "detached\ncheckout")
	runWorktreeGit(t, root, "worktree", "add", "--detach", detached)
	entries, err := listGitWorktrees(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || entries[2].Path != detached || !entries[2].Detached {
		t.Fatalf("worktrees = %#v", entries)
	}
	m := worktreeTestManifest(root)
	w, err := newStackWorktrees(m, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.prepare(w.snapshot()[0].ID, linked, m); err != nil {
		t.Fatalf("locked worktree must remain runnable: %v", err)
	}
}

func TestWorktreeToolsFollowSelection(t *testing.T) {
	root, linked := createWorktreeRepository(t)
	m := worktreeTestManifest(root)
	m.Annotation.Actions = []manifest.ValidatedAnnotationAction{
		{ID: "command", Kind: "command", Cwd: filepath.Join(root, "api")},
		{ID: "agent", Kind: "agent", Agent: manifest.ValidatedAgent{Kind: "configured", Cwd: filepath.Join(root, "web")}},
	}
	w, err := newStackWorktrees(m, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id := w.snapshot()[0].ID
	if _, err := w.prepare(id, linked, m); err != nil {
		t.Fatal(err)
	}
	if _, err := w.toolContext(m, "web"); err == nil {
		t.Fatal("tools launched while switching")
	}
	w.finish(id, nil)
	context, err := w.toolContext(m, "web")
	if err != nil {
		t.Fatal(err)
	}
	if context.ProjectRootPath != linked || context.AnnotationActions[0].Cwd != filepath.Join(linked, "api") || context.AnnotationActions[1].Agent.Cwd != filepath.Join(linked, "web") {
		t.Fatalf("tool context = %#v", context)
	}
	if context.ResolvePath(filepath.Join(root, "web", "file.tsx")) != filepath.Join(linked, "web", "file.tsx") {
		t.Fatal("absolute source paths retained configured checkout")
	}
	if context.ResolvePath(filepath.Join(linked, "web", "file.tsx")) != filepath.Join(linked, "web", "file.tsx") {
		t.Fatal("selected source paths were rewritten twice")
	}
	nested := filepath.Join(root, ".workspaces", "second")
	runWorktreeGit(t, root, "worktree", "add", "-b", "feature/second", nested)
	if _, err := w.prepare(id, nested, m); err != nil {
		t.Fatal(err)
	}
	w.finish(id, nil)
	context, err = w.toolContext(m, "web")
	if err != nil {
		t.Fatal(err)
	}
	if context.ResolvePath(filepath.Join(linked, "web", "file.tsx")) != filepath.Join(nested, "web", "file.tsx") || context.ResolvePath(filepath.Join(nested, "web", "file.tsx")) != filepath.Join(nested, "web", "file.tsx") {
		t.Fatal("source metadata from a previous checkout was not remapped to the selected nested checkout")
	}
}

func createWorktreeRepository(t *testing.T) (string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "shop")
	for _, dir := range []string{"web", "api"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, dir, "source.txt"), []byte("source"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	runWorktreeGit(t, root, "init", "-b", "main")
	runWorktreeGit(t, root, "add", ".")
	runWorktreeGit(t, root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "initial")
	linked := filepath.Join(t.TempDir(), "feature checkout")
	runWorktreeGit(t, root, "worktree", "add", "-b", "feature/cart", linked)
	return root, linked
}

func runWorktreeGit(t *testing.T, cwd string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", cwd}, args...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func worktreeTestManifest(root string) ResolvedManifest {
	return ResolvedManifest{
		ManifestPath: filepath.Join(root, "devhost.toml"), ManifestDirectoryPath: root,
		Worktrees: manifest.WorktreesConfig{Enabled: true}, ServiceOrder: []string{"api", "web"},
		Services: map[string]ResolvedService{
			"api": {Name: "api", Cwd: filepath.Join(root, "api"), Managed: true, Command: []string{"service"}},
			"web": {Name: "web", Cwd: filepath.Join(root, "web"), Managed: true, Command: []string{"service"}, DependsOn: []string{"api"}},
		},
	}
}
