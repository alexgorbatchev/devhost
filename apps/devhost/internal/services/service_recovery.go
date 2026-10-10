package services

import (
	"fmt"
	"net"
	"strconv"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/devtools"
)

func (r *stackRuntime) recovery(name string) devtools.RecoveryState {
	r.manifestMu.RLock()
	service, exists := r.manifest.Services[name]
	state := devtools.RecoveryState{Stack: r.manifest.Name, Service: name, Phase: "unavailable", Title: name + " is unavailable"}
	starting, complete, failure, blocked := r.starting[name], r.startupComplete, r.failures[name], r.blocked[name]
	_, pending := r.pendingReload[name]
	worktrees := r.worktrees
	r.startedMu.Lock()
	started := findStartedService(r.started, name)
	r.startedMu.Unlock()
	r.manifestMu.RUnlock()
	state.Repositories = worktrees.snapshot()
	for _, repo := range state.Repositories {
		for _, member := range repo.ServiceNames {
			if member == name && repo.Switching {
				starting, blocked = true, ""
			}
		}
	}
	if !exists {
		state.Message = "This service is no longer configured."
		return state
	}
	if service.Port != nil {
		state.Address = net.JoinHostPort(service.BindHost, strconv.Itoa(*service.Port))
	}
	state.CanRestart = complete && isManagedService(service) && !starting && !pending
	r.controlMu.RLock()
	control := r.control
	r.controlMu.RUnlock()
	if control != nil {
		state.Logs = control.ServiceLogLines(name)
	}
	switch {
	case blocked != "":
		state.Message = blocked
		state.CanRestart = complete && isManagedService(service) && !pending
	case starting || pending || (started != nil && started.isRestartingValue()):
		state.Phase, state.Title = "starting", "Starting "+name
		state.Message = "Waiting for the service to pass its health check. This page will reload when it is ready."
		state.CanRestart = false
	case failure != "":
		state.Title = name + " could not start"
		state.Message = failure
	case started != nil && started.unexpectedExitCode() != nil:
		state.Title = name + " exited"
		state.Message = fmt.Sprintf("The process exited with code %d. View its logs below and restart it when you are ready.", *started.unexpectedExitCode())
	case (started != nil || !isManagedService(service) || usesDaemonLifecycle(service)) && CheckServiceHealth(service.Health):
		state.Phase, state.Title, state.Message = "ready", name+" is ready", ""
	default:
		state.Message = "The service is not responding. View its logs below and restart it when you are ready."
	}
	return state
}
