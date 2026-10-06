package services

import "fmt"

// refreshWorktrees reconciles checkout availability with the running groups.
// It shares the lifecycle lock with restarts and switches, so a refresh cannot
// stop a group while another operation is moving it to a healthy checkout.
func (r *stackRuntime) refreshWorktrees() error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	if err := r.checkReady(); err != nil {
		return err
	}
	if err := r.worktrees.refresh(); err != nil {
		return err
	}
	var result error
	for _, repo := range r.worktrees.snapshot() {
		if repo.RunningPath == "" {
			continue
		}
		var available bool
		for _, entry := range repo.Worktrees {
			if entry.Path == repo.SelectedPath {
				available = entry.Available
				break
			}
		}
		if available {
			continue
		}
		err := fmt.Errorf("Selected checkout %s is unavailable; choose a checkout to recover repository %s.", repo.SelectedPath, repo.Name)
		for _, name := range repo.ServiceNames {
			r.watcher.StopWatching(name)
			r.dirty.SetDirty(name, false)
		}
		stopErr := r.stopGroup(r.orderedGroup(repo.ServiceNames))
		result = appendCleanupError(result, stopErr)
		err = joinCleanupError(err, stopErr)
		r.manifestMu.Lock()
		for _, name := range repo.ServiceNames {
			r.blocked[name] = err.Error()
		}
		r.manifestMu.Unlock()
		r.worktrees.finish(repo.ID, err)
		r.logFailure(repo.ServiceNames[0], err)
	}
	r.publish()
	return result
}
