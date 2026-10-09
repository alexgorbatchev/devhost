package services

import (
	"fmt"
	"reflect"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func validateReloadBoundary(previous, next manifest.Manifest) error {
	checks := []struct {
		name           string
		previous, next any
	}{
		{"name", previous.Name, next.Name},
		{"caddy", previous.Caddy, next.Caddy},
		{"devtools", previous.Devtools, next.Devtools},
		{"annotation", previous.Annotation, next.Annotation},
		{"worktrees.enabled", previous.Worktrees, next.Worktrees},
		{"killZombies", previous.KillZombies, next.KillZombies},
	}
	for _, check := range checks {
		if !reflect.DeepEqual(check.previous, check.next) {
			return fmt.Errorf("changing %s requires restarting devhost; no configuration changes were applied", check.name)
		}
	}
	return nil
}

func affectedReloadServices(previous, next ResolvedManifest) map[string]bool {
	affected := map[string]bool{}
	for name, old := range previous.Services {
		service, exists := next.Services[name]
		if !exists || !reflect.DeepEqual(old, service) || !reflect.DeepEqual(CreateInjectedServiceEnvironment(previous, old), CreateInjectedServiceEnvironment(next, service)) {
			affected[name] = true
		}
	}
	for name := range next.Services {
		if _, exists := previous.Services[name]; !exists {
			affected[name] = true
		}
	}
	return affected
}

func expandReloadGroups(affected map[string]bool, previous, next ResolvedManifest, worktrees ...*stackWorktrees) {
	for {
		count := len(affected)
		for _, m := range []ResolvedManifest{previous, next} {
			for name, service := range m.Services {
				for _, dependency := range service.DependsOn {
					if affected[dependency] {
						affected[name] = true
					}
				}
			}
		}
		for _, w := range worktrees {
			for _, repo := range w.snapshot() {
				for _, name := range repo.ServiceNames {
					// A service that joins a repository starts in the checkout the
					// group already runs from, so its siblings keep running.
					if _, existed := previous.Services[name]; !affected[name] || !existed {
						continue
					}
					for _, member := range repo.ServiceNames {
						affected[member] = true
					}
					break
				}
			}
		}
		if len(affected) == count {
			return
		}
	}
}

func reloadOrder(order []string, affected map[string]bool) []string {
	var names []string
	for _, name := range order {
		if affected[name] {
			names = append(names, name)
		}
	}
	return names
}
