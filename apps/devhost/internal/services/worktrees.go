package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

type stackWorktrees struct {
	mu       sync.RWMutex
	groups   []*worktreeGroup
	stateDir string
}

type worktreeGroup struct {
	view       devtools.WorktreeRepository
	repository gitRepository
	offsets    map[string]string
}

type savedWorktree struct {
	Path string `json:"path"`
}

func newStackWorktrees(m ResolvedManifest, stateDir string) (*stackWorktrees, error) {
	return buildStackWorktrees(m, stateDir, nil)
}

func buildStackWorktrees(m ResolvedManifest, stateDir string, previous *stackWorktrees) (*stackWorktrees, error) {
	if !m.Worktrees.Enabled {
		return nil, nil
	}
	manifestPath, err := filepath.Abs(m.ManifestPath)
	if err != nil {
		return nil, err
	}
	w := &stackWorktrees{stateDir: filepath.Join(stateDir, "worktrees", worktreeKey(manifestPath))}
	for _, name := range orderedManifestServiceNames(m) {
		s := m.Services[name]
		repo, cwd, err := configuredWorktreeRepository(s.Cwd, previous)
		if err != nil {
			return nil, fmt.Errorf("discover repository for service %s: %w", name, err)
		}
		if repo.root == "" {
			continue
		}
		g := w.group(worktreeKey(repo.commonDir))
		if g == nil {
			g = &worktreeGroup{repository: repo, offsets: map[string]string{}, view: devtools.WorktreeRepository{
				ID: worktreeKey(repo.commonDir), Name: filepath.Base(repo.root), ConfiguredPath: repo.root, SelectedPath: repo.root,
			}}
			w.groups = append(w.groups, g)
		}
		if repo.root != g.repository.root {
			return nil, fmt.Errorf("services in repository %s have cwd values in different checkouts; configure one checkout before enabling worktrees", g.view.Name)
		}
		offset, err := filepath.Rel(repo.root, cwd)
		if err != nil {
			return nil, err
		}
		g.offsets[name] = offset
		g.view.ServiceNames = append(g.view.ServiceNames, name)
		if !isManagedService(s) {
			g.view.BlockedReason = fmt.Sprintf("Service %s is external; devhost cannot switch every service in this repository.", name)
		}
	}
	for _, g := range w.groups {
		data, err := os.ReadFile(w.selectionPath(g.view.ID))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("read saved worktree: %w", err)
		}
		if err == nil {
			var saved savedWorktree
			if err := json.Unmarshal(data, &saved); err != nil || !filepath.IsAbs(saved.Path) {
				return nil, fmt.Errorf("invalid saved worktree in %s", w.selectionPath(g.view.ID))
			}
			g.view.SelectedPath = saved.Path
		}
		if err := g.refresh(); err != nil {
			return nil, err
		}
	}
	return w, nil
}

func configuredWorktreeRepository(cwd string, previous *stackWorktrees) (gitRepository, string, error) {
	repo, err := discoverGitRepository(cwd)
	if err == nil {
		if repo.root == "" {
			return repo, cwd, nil
		}
		resolved, err := filepath.EvalSymlinks(cwd)
		return repo, resolved, err
	}
	if previous == nil {
		return repo, "", err
	}
	abs, absErr := filepath.Abs(cwd)
	if absErr != nil {
		return repo, "", absErr
	}
	previous.mu.RLock()
	defer previous.mu.RUnlock()
	var known gitRepository
	for _, group := range previous.groups {
		if _, within := pathWithin(group.repository.root, abs); !within {
			continue
		}
		if _, statErr := os.Stat(group.repository.root); !errors.Is(statErr, os.ErrNotExist) {
			continue
		}
		if len(group.repository.root) > len(known.root) {
			known = group.repository
		}
	}
	if known.root != "" {
		// The configured checkout is gone, but the known common directory and
		// offset still identify this service. Restore validates its selected cwd.
		return known, abs, nil
	}
	return repo, "", err
}

func worktreeKey(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func (w *stackWorktrees) group(id string) *worktreeGroup {
	for _, g := range w.groups {
		if g.view.ID == id {
			return g
		}
	}
	return nil
}

func (w *stackWorktrees) snapshot() []devtools.WorktreeRepository {
	if w == nil {
		return nil
	}
	w.mu.RLock()
	defer w.mu.RUnlock()
	views := make([]devtools.WorktreeRepository, 0, len(w.groups))
	for _, g := range w.groups {
		view := g.view
		view.ServiceNames = append([]string{}, view.ServiceNames...)
		view.Worktrees = append([]devtools.Worktree{}, view.Worktrees...)
		views = append(views, view)
	}
	return views
}

func (w *stackWorktrees) refresh() error {
	if w == nil {
		return fmt.Errorf("worktrees are not enabled")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, g := range w.groups {
		if err := g.refresh(); err != nil {
			return err
		}
	}
	return nil
}

func (g *worktreeGroup) refresh() error {
	entries, err := listGitWorktrees(g.repository.commonDir)
	if err != nil {
		return err
	}
	foundSelected := false
	for i := range entries {
		entry := &entries[i]
		if entry.Path == g.view.SelectedPath {
			foundSelected = true
		}
		if entry.Reason != "" {
			continue
		}
		entry.Directories, err = g.directories(entry.Path)
		entry.Available = err == nil
		if err != nil {
			entry.Reason = err.Error()
		}
	}
	if !foundSelected {
		entries = append(entries, devtools.Worktree{Path: g.view.SelectedPath, Reason: "Saved checkout is no longer registered with Git.", Directories: []devtools.WorktreeDirectory{}})
	}
	g.view.Worktrees = entries
	return nil
}

func (g *worktreeGroup) directories(root string) ([]devtools.WorktreeDirectory, error) {
	repo, err := discoverGitRepository(root)
	if err != nil {
		return nil, err
	}
	if repo.root != root || repo.commonDir != g.repository.commonDir {
		return nil, fmt.Errorf("Checkout %s no longer belongs to this repository.", root)
	}
	dirs := make([]devtools.WorktreeDirectory, 0, len(g.offsets))
	for _, name := range g.view.ServiceNames {
		cwd := filepath.Join(root, g.offsets[name])
		info, err := os.Stat(cwd)
		if err != nil {
			return dirs, fmt.Errorf("Service %s directory is unavailable: %s", name, cwd)
		}
		if !info.IsDir() {
			return dirs, fmt.Errorf("Service %s cwd is not a directory: %s", name, cwd)
		}
		resolved, err := filepath.EvalSymlinks(cwd)
		if err != nil {
			return dirs, err
		}
		if _, ok := pathWithin(root, resolved); !ok {
			return dirs, fmt.Errorf("Service %s directory escapes checkout %s", name, root)
		}
		identity, err := discoverGitRepository(resolved)
		if err != nil {
			return dirs, err
		}
		if identity != repo {
			return dirs, fmt.Errorf("Service %s directory belongs to a different repository", name)
		}
		dirs = append(dirs, devtools.WorktreeDirectory{Name: name, Cwd: cwd})
	}
	return dirs, nil
}

func pathWithin(root, path string) (string, bool) {
	rel, err := filepath.Rel(root, path)
	return rel, err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (w *stackWorktrees) restore(m ResolvedManifest) (ResolvedManifest, map[string]string) {
	blocked := map[string]string{}
	if w == nil {
		return m, blocked
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	m.Services = maps.Clone(m.Services)
	for _, g := range w.groups {
		dirs, err := g.validateSelection(g.view.SelectedPath)
		if err != nil {
			g.view.Error = err.Error()
			for _, name := range g.view.ServiceNames {
				blocked[name] = err.Error()
			}
			continue
		}
		applyWorktreeDirectories(&m, dirs)
	}
	return m, blocked
}

func (g *worktreeGroup) validateSelection(path string) ([]devtools.WorktreeDirectory, error) {
	if g.view.BlockedReason != "" && path != g.view.ConfiguredPath {
		return nil, errors.New(g.view.BlockedReason)
	}
	for _, entry := range g.view.Worktrees {
		if entry.Path != path {
			continue
		}
		if !entry.Available {
			return nil, fmt.Errorf("Worktree is unavailable: %s", entry.Reason)
		}
		return g.directories(path)
	}
	return nil, fmt.Errorf("Worktree %s is not registered with this repository", path)
}

func applyWorktreeDirectories(m *ResolvedManifest, dirs []devtools.WorktreeDirectory) {
	for _, dir := range dirs {
		s := m.Services[dir.Name]
		s.Cwd = dir.Cwd
		m.Services[dir.Name] = s
	}
}

func (w *stackWorktrees) prepare(id, path string, m ResolvedManifest) (ResolvedManifest, error) {
	if w == nil {
		return m, fmt.Errorf("worktrees are not enabled")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.group(id)
	if g == nil {
		return m, fmt.Errorf("unknown repository: %s", id)
	}
	if g.view.BlockedReason != "" {
		return m, errors.New(g.view.BlockedReason)
	}
	if err := g.refresh(); err != nil {
		return m, err
	}
	dirs, err := g.validateSelection(path)
	if err != nil {
		return m, err
	}
	if err := w.save(id, path); err != nil {
		return m, err
	}
	g.view.SelectedPath, g.view.Switching, g.view.Error = path, true, ""
	m.Services = maps.Clone(m.Services)
	applyWorktreeDirectories(&m, dirs)
	return m, nil
}

func (w *stackWorktrees) finish(id string, err error) {
	if w == nil {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	g := w.group(id)
	if g == nil {
		return
	}
	g.view.Switching = false
	if err != nil {
		g.view.Error, g.view.RunningPath = err.Error(), ""
	} else {
		g.view.Error, g.view.RunningPath = "", g.view.SelectedPath
	}
}

func (w *stackWorktrees) projectRoot(configured, name string) string {
	if w == nil {
		return configured
	}
	w.mu.RLock()
	defer w.mu.RUnlock()
	for _, g := range w.groups {
		if _, ok := g.offsets[name]; !ok {
			continue
		}
		if rel, ok := pathWithin(g.repository.root, configured); ok {
			return filepath.Join(g.view.SelectedPath, rel)
		}
		return g.view.SelectedPath
	}
	return configured
}

func (w *stackWorktrees) toolContext(m ResolvedManifest, name string) (devtools.ToolContext, error) {
	result := devtools.ToolContext{ProjectRootPath: m.ManifestDirectoryPath, AnnotationActions: append([]manifest.ValidatedAnnotationAction{}, m.Annotation.Actions...)}
	if w == nil {
		return result, nil
	}
	w.mu.RLock()
	defer w.mu.RUnlock()
	for _, g := range w.groups {
		if _, ok := g.offsets[name]; !ok {
			continue
		}
		if g.view.Switching || g.view.Error != "" {
			return result, fmt.Errorf("Repository %s is switching or stopped; recover its selected worktree before launching tools.", g.view.Name)
		}
		configured, selected := g.repository.root, g.view.SelectedPath
		roots := []string{configured}
		for _, entry := range g.view.Worktrees {
			roots = append(roots, entry.Path)
		}
		sort.Slice(roots, func(i, j int) bool { return len(roots[i]) > len(roots[j]) })
		result.ResolvePath = func(path string) string {
			if _, ok := pathWithin(selected, path); ok {
				return path
			}
			for _, root := range roots {
				if rel, ok := pathWithin(root, path); ok {
					return filepath.Join(selected, rel)
				}
			}
			return path
		}
		if rel, ok := pathWithin(configured, m.ManifestDirectoryPath); ok {
			result.ProjectRootPath = filepath.Join(selected, rel)
		} else {
			result.ProjectRootPath = selected
		}
		for i := range result.AnnotationActions {
			action := &result.AnnotationActions[i]
			action.Cwd = result.ResolvePath(action.Cwd)
			action.Agent.Cwd = result.ResolvePath(action.Agent.Cwd)
		}
		break
	}
	return result, nil
}

func (w *stackWorktrees) selectionPath(id string) string {
	return filepath.Join(w.stateDir, id+".json")
}

func (w *stackWorktrees) save(id, path string) error {
	if err := os.MkdirAll(w.stateDir, 0o700); err != nil {
		return fmt.Errorf("create worktree state: %w", err)
	}
	data, err := json.Marshal(savedWorktree{Path: path})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(w.stateDir, ".selection-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), w.selectionPath(id)); err != nil {
		return fmt.Errorf("save worktree selection: %w", err)
	}
	return nil
}
