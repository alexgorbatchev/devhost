package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

const gitWorktreeTimeout = 5 * time.Second

type gitRepository struct {
	root      string
	commonDir string
}

func runGit(cwd string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitWorktreeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", cwd}, args...)...)
	// Repository identity must come from the configured cwd, not the caller's Git overrides.
	for _, value := range os.Environ() {
		key, _, _ := strings.Cut(value, "=")
		if strings.HasPrefix(key, "GIT_") || key == "LC_ALL" {
			continue
		}
		cmd.Env = append(cmd.Env, value)
	}
	cmd.Env = append(cmd.Env, "LC_ALL=C", "GIT_TERMINAL_PROMPT=0")
	var stderr strings.Builder
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("git in %s: %w: %s", cwd, err, strings.TrimSpace(stderr.String()))
	}
	return strings.TrimSuffix(string(out), "\n"), nil
}

func discoverGitRepository(cwd string) (gitRepository, error) {
	root, err := runGit(cwd, "rev-parse", "--show-toplevel")
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && strings.Contains(err.Error(), "not a git repository") {
			return gitRepository{}, nil
		}
		return gitRepository{}, err
	}
	common, err := runGit(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return gitRepository{}, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return gitRepository{}, fmt.Errorf("resolve checkout %s: %w", root, err)
	}
	common, err = filepath.EvalSymlinks(common)
	if err != nil {
		return gitRepository{}, fmt.Errorf("resolve repository %s: %w", common, err)
	}
	return gitRepository{root: root, commonDir: common}, nil
}

func listGitWorktrees(cwd string) ([]devtools.Worktree, error) {
	out, err := runGit(cwd, "worktree", "list", "--porcelain", "-z")
	if err != nil {
		return nil, err
	}
	entries := []devtools.Worktree{}
	var entry devtools.Worktree
	for _, field := range strings.Split(out, "\x00") {
		key, value, _ := strings.Cut(field, " ")
		switch key {
		case "worktree":
			entry = devtools.Worktree{Path: value, Directories: []devtools.WorktreeDirectory{}}
		case "HEAD":
			entry.Head = value
		case "branch":
			entry.Branch = strings.TrimPrefix(value, "refs/heads/")
		case "detached":
			entry.Detached = true
		case "bare":
			entry.Reason = "Bare repositories cannot run services."
		case "":
			if entry.Path != "" {
				entries = append(entries, entry)
				entry = devtools.Worktree{}
			}
		}
	}
	return entries, nil
}

// Remote HEAD records the default branch without a network request. When remotes
// disagree (or no HEAD is recorded), leave the default unknown rather than guess.
func defaultGitBranch(cwd string) (string, error) {
	out, err := runGit(cwd, "for-each-ref", "--format=%(refname)%00%(symref)", "refs/remotes/")
	if err != nil {
		return "", err
	}
	branch := ""
	for line := range strings.SplitSeq(out, "\n") {
		ref, target, _ := strings.Cut(line, "\x00")
		remote, isHead := strings.CutSuffix(ref, "/HEAD")
		if !isHead || !strings.HasPrefix(target, remote+"/") {
			continue
		}
		candidate := strings.TrimPrefix(target, remote+"/")
		if branch != "" && branch != candidate {
			return "", nil
		}
		branch = candidate
	}
	return branch, nil
}
