package services

import "context"

func (r *stackRuntime) recoverWorktree(ctx context.Context, id string) (returnedError error) {
	var names []string
	for _, repo := range r.worktrees.snapshot() {
		if repo.ID == id {
			names = repo.ServiceNames
			break
		}
	}
	ordered := r.orderedGroup(names)
	defer func() {
		r.manifestMu.Lock()
		for _, name := range ordered {
			if returnedError != nil {
				r.blocked[name] = returnedError.Error()
			} else {
				delete(r.blocked, name)
			}
		}
		r.manifestMu.Unlock()
		r.worktrees.finish(id, returnedError)
		r.publish()
	}()
	r.publish()
	for _, name := range ordered {
		r.watcher.StopWatching(name)
		r.dirty.SetDirty(name, false)
	}
	if err := r.stopGroup(ordered); err != nil {
		return err
	}
	for _, name := range ordered {
		s := r.manifest.Services[name]
		if err := r.watcher.StartWatching(name, s.Watch, s.Cwd); err != nil {
			returnedError = err
			break
		}
		if err := r.start(ctx, name, runtimeStartOptions{RefreshRoute: true}); err != nil {
			returnedError = err
			r.logFailure(name, err)
			break
		}
	}
	if returnedError != nil {
		returnedError = joinCleanupError(returnedError, r.stopGroup(ordered))
		return returnedError
	}
	return nil
}
