package services

import (
	"context"
	"fmt"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

// Recheck the complete stack: an earlier service may exit while a later one
// starts. Readiness is published only after routes and both watchers are live.
func (r *stackRuntime) publishDetachedReady(ctx context.Context, paths caddy.Paths) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	r.startedMu.Lock()
	startedServices := append([]*startedService{}, r.started...)
	r.startedMu.Unlock()
	for _, started := range startedServices {
		if err := throwIfExited(started.ReadExitCode, started.service.Name); err != nil {
			return err
		}
	}
	var urls []string
	for _, name := range orderedManifestServiceNames(*r.manifest) {
		service := r.manifest.Services[name]
		if !probeServiceHealth(ctx, service.Health) {
			if err := ctx.Err(); err != nil {
				return err
			}
			return fmt.Errorf("service %s became unhealthy before detached startup completed", name)
		}
		urls = append(urls, readServiceURLs(service, r.manifest.Caddy.HTTPSPort)...)
	}
	return caddy.SetStackReady(paths, urls)
}
