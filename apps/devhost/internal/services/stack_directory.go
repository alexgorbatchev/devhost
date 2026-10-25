package services

import (
	"context"
	"maps"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

func (r *stackRuntime) directoryServices(ctx context.Context) ([]statuspage.StackService, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	r.manifestMu.RLock()
	m := *r.manifest
	starting, failures := maps.Clone(r.starting), maps.Clone(r.failures)
	r.manifestMu.RUnlock()
	r.startedMu.Lock()
	started := append([]*startedService{}, r.started...)
	r.startedMu.Unlock()
	port := m.Caddy.HTTPSPort
	settings, ok, err := caddy.ReadAppliedManagedCaddySettings(r.routes.paths)
	if err != nil {
		return nil, err
	}
	if ok {
		port = settings.HTTPSPort
	}
	services := make([]statuspage.StackService, 0, len(m.Services))
	for _, name := range orderedManifestServiceNames(m) {
		service := m.Services[name]
		status := "Running"
		process := findStartedService(started, name)
		switch {
		case starting[name]:
			status = "Starting"
		case failures[name] != "":
			status = "Failed"
		case process != nil && process.isRestartingValue():
			status = "Restarting"
		case process != nil && process.ReadExitCode() != nil:
			status = "Exited"
		case !isManagedService(service):
			status = "External"
		}
		services = append(services, statuspage.StackService{Name: name, Directory: service.Cwd, URLs: readServiceURLs(service, port), Status: status})
	}
	for _, name := range stoppedServiceNames(m) {
		services = append(services, statuspage.StackService{Name: name, Directory: m.Stopped[name].Cwd, Status: "Not started"})
	}
	return services, nil
}
