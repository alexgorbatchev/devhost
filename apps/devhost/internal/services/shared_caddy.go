package services

import (
	"fmt"
	"runtime"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

// ensureManagedCaddyRunning checks that the shared Caddy answers on the admin
// address it runs. A manifest-free serve session starts it with settings; a
// stack leaves starting it to devhost caddy start.
func ensureManagedCaddyRunning(paths caddy.Paths, settings caddy.ManagedCaddyGlobalSettings, options StartStackOptions, label string) error {
	running, recorded, err := caddy.ReadAppliedManagedCaddySettings(paths)
	if err != nil {
		return err
	}
	if !recorded {
		running = settings
	}
	err = caddy.EnsureManagedCaddyAdminAvailable(caddy.CreateCaddyAdminAPIURL(running.AdminAddress), caddy.AdminAvailabilityDependencies{})
	if err == nil {
		// A stack joining a running Caddy cannot install its local CA; it says so once.
		if warning := caddy.RootCertificateTrustWarning(paths.RootCertificatePath); warning != "" {
			cliout.Log(options.LogWriter, label, cliout.Warning(warning))
		}
		return nil
	}
	if !options.serveSession {
		return err
	}
	// Starting Caddy also installs its local CA when the system does not trust it.
	if _, err := caddy.RunManagedCaddyLifecycleCommand(caddy.LifecycleStart, options.LogWriter, paths, settings, caddy.ManagedCaddyLifecycleDependencies{Quiet: options.CaddyOutputWriters.Quiet, RuntimeOS: runtime.GOOS}); err != nil {
		return err
	}

	return caddy.EnsureManagedCaddyAdminAvailable(caddy.CreateCaddyAdminAPIURL(settings.AdminAddress), caddy.AdminAvailabilityDependencies{})
}

// watchSharedConfig reports saves of the devhost config file with the same
// debounce as the manifest.
func watchSharedConfig(path string) (*manifestWatcher, error) {
	return newManifestWatcher(sharedConfigInputs(path))
}

func sharedConfigInputs(path string) manifest.Inputs {
	return manifest.Inputs{Files: []string{path}}
}

// applySharedConfig applies a saved devhost config file: it moves the shared
// Caddy to the file's listener settings, unless another stack already did, and
// points this stack's service URLs at them. A file that is invalid, or that
// Caddy rejects, leaves Caddy and the stack on the settings they run.
func (r *stackRuntime) applySharedConfig(path string, w *manifestWatcher) error {
	r.operationMu.Lock()
	defer r.operationMu.Unlock()
	// The config directory may have been created since the last save; watch the
	// nearest directory that exists now.
	if err := w.update(sharedConfigInputs(path)); err != nil {
		return err
	}
	shared, err := config.Read(path)
	if err != nil {
		return err
	}
	if _, err := caddy.ApplyManagedCaddySettings(r.routes.paths, shared.Caddy, r.options.CaddyOutputWriters); err != nil {
		return fmt.Errorf("apply the devhost config file %s: %w", path, err)
	}
	r.manifestMu.Lock()
	changed := r.manifest.Caddy != shared.Caddy
	r.manifest.Caddy = shared.Caddy
	r.routes.manifest.Caddy = shared.Caddy
	r.manifestMu.Unlock()
	if !changed {
		return nil
	}
	r.publish()
	cliout.Log(r.options.LogWriter, r.manifest.Name, "Applied the shared Caddy settings from "+path+".")
	LogServiceURLs(*r.manifest, r.options.LogWriter)
	return nil
}
