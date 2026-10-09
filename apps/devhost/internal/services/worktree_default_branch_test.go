package services

import "testing"

func TestWorktreeDefaultBranchFromGit(t *testing.T) {
	tests := []struct {
		name     string
		defaults map[string]string
		want     string
	}{
		{name: "unknown without remote HEAD", want: ""},
		{name: "custom branch", defaults: map[string]string{"origin": "trunk"}, want: "trunk"},
		{name: "renamed remote and slash in branch", defaults: map[string]string{"upstream": "release/stable"}, want: "release/stable"},
		{name: "matching remotes", defaults: map[string]string{"origin": "trunk", "upstream": "trunk"}, want: "trunk"},
		{name: "conflicting remotes", defaults: map[string]string{"origin": "trunk", "upstream": "release"}, want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			root, linked := createWorktreeRepository(t)
			// Neither the checkout branch nor the new-repository preference is the remote default.
			runWorktreeGit(t, root, "config", "init.defaultBranch", "unrelated")
			for remote, branch := range tt.defaults {
				setWorktreeRemoteHead(t, root, remote, branch)
			}
			w, err := newStackWorktrees(worktreeTestManifest(linked), t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if got := w.snapshot()[0].DefaultBranch; got != tt.want {
				t.Fatalf("default branch = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestWorktreeRefreshUpdatesDefaultBranch(t *testing.T) {
	root, _ := createWorktreeRepository(t)
	setWorktreeRemoteHead(t, root, "origin", "trunk")
	w, err := newStackWorktrees(worktreeTestManifest(root), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got := w.snapshot()[0].DefaultBranch; got != "trunk" {
		t.Fatalf("initial default branch = %q", got)
	}
	setWorktreeRemoteHead(t, root, "origin", "release/stable")
	if err := w.refresh(); err != nil {
		t.Fatal(err)
	}
	if got := w.snapshot()[0].DefaultBranch; got != "release/stable" {
		t.Fatalf("refreshed default branch = %q", got)
	}
	runWorktreeGit(t, root, "symbolic-ref", "--delete", "refs/remotes/origin/HEAD")
	if err := w.refresh(); err != nil {
		t.Fatal(err)
	}
	if got := w.snapshot()[0].DefaultBranch; got != "" {
		t.Fatalf("removed remote HEAD retained default branch %q", got)
	}
}

func setWorktreeRemoteHead(t *testing.T, root, remote, branch string) {
	t.Helper()
	ref := "refs/remotes/" + remote + "/" + branch
	runWorktreeGit(t, root, "update-ref", ref, "HEAD")
	runWorktreeGit(t, root, "symbolic-ref", "refs/remotes/"+remote+"/HEAD", ref)
}
