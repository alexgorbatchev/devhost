package services

import (
	"context"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
)

func remoteManifestHosts(value manifest.Manifest, settings remote.Settings) (manifest.Manifest, error) {
	return resolveManifestHosts(value, settings.DomainSuffix, true)
}

func resolveManifestHosts(value manifest.Manifest, suffix string, remoteMode bool) (manifest.Manifest, error) {
	value.Services = maps.Clone(value.Services)
	pathsByHost := map[string][]string{}
	for _, name := range slices.Sorted(maps.Keys(value.Services)) {
		service := value.Services[name]
		service.Hosts = slices.Clone(service.Hosts)
		for i, host := range service.Hosts {
			if suffix == "" {
				return manifest.Manifest{}, fmt.Errorf("domainSuffix is required")
			}
			if remoteMode && !manifest.IsValidHostLabel(host) {
				return manifest.Manifest{}, fmt.Errorf("service %s hostname %q must be a single DNS label for remote previews; use host = \"web\" and let remote.domainSuffix supply the domain", name, host)
			}
			if !strings.Contains(host, ".") {
				host += suffix
			}
			if !manifest.IsValidHost(host) {
				return manifest.Manifest{}, fmt.Errorf("service %s resolved hostname %q is invalid", name, host)
			}
			if service.Path != nil {
				if conflicting := manifest.ReadConflictingRoutePath(pathsByHost[host], *service.Path); conflicting != "" {
					return manifest.Manifest{}, fmt.Errorf("service %s path %s overlaps another routed service on host %s: %s", name, *service.Path, host, conflicting)
				}
				pathsByHost[host] = append(pathsByHost[host], *service.Path)
			}
			service.Hosts[i] = host
		}
		value.Services[name] = service
	}
	return value, nil
}

func (m ResolvedManifest) publicHTTPSPort() int {
	if m.Remote != nil {
		return 443
	}
	return m.Caddy.HTTPSPort
}

func (m ResolvedManifest) serviceURLs(service ResolvedService) []string {
	if m.Remote != nil {
		// Unrouted dependencies have no public preview URL.
		return readManagedServiceURLs(service, m.publicHTTPSPort())
	}
	return readServiceURLs(service, m.publicHTTPSPort())
}

func (r *stackRuntime) remoteOptions(m ResolvedManifest) (remote.Options, error) {
	host, err := caddy.ResolveProxyHost(m.Caddy.BindHost)
	if err != nil {
		return remote.Options{}, err
	}
	return remote.Options{
		StateDirectory: r.routes.paths.StateDirectoryPath,
		ManifestPath:   m.ManifestPath,
		Settings:       *m.Remote,
		Hosts:          collectClaimedHosts(m.Services),
		Backend:        remote.Backend{Scheme: "https", Address: caddy.FormatProxyAddress(host, m.Caddy.HTTPSPort), RootCertificatePath: r.routes.paths.RootCertificatePath},
	}, nil
}

func (r *stackRuntime) acquireRemote(ctx context.Context) error {
	if r.manifest.Remote == nil {
		return nil
	}
	options, err := r.remoteOptions(*r.manifest)
	if err != nil {
		return err
	}
	lease, err := remote.Acquire(ctx, options)
	if err != nil {
		return fmt.Errorf("start remote previews: %w", err)
	}
	r.remoteLease = lease
	return nil
}

func (r *stackRuntime) updateRemote(ctx context.Context, m ResolvedManifest) error {
	if r.remoteLease == nil {
		return nil
	}
	options, err := r.remoteOptions(m)
	if err != nil {
		return err
	}
	return r.remoteLease.Update(ctx, options)
}

func (r *stackRuntime) checkRemoteSettings(next *remote.Settings) error {
	current := r.manifest.Remote
	if current != nil && (next == nil || *next != *current) {
		return fmt.Errorf("remote settings changed while this stack is running; stop all remote stacks, then start them again to apply the new settings")
	}
	return nil
}

// checkRoutingSettings keeps the mode and suffix selected at startup stable.
func (r *stackRuntime) checkRoutingSettings(next config.Config) error {
	if err := r.checkRemoteSettings(next.Remote); err != nil {
		return err
	}
	if r.manifest.Remote == nil && r.manifest.DomainSuffix != "" && r.manifest.DomainSuffix != next.DomainSuffix {
		return fmt.Errorf("local domainSuffix changed while this stack is running; stop this stack, then start it again to apply the new suffix")
	}
	return nil
}
