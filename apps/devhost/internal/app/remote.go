package app

import (
	"context"
	"fmt"
	"io"
	"os/signal"
	"syscall"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func resolveStartManifest(value manifest.Manifest, requested []string, useRemote bool) (services.ResolvedManifest, error) {
	if !useRemote {
		return services.ResolveRequestedServicePorts(value, requested)
	}
	path, err := config.Path(readEnvironment())
	if err != nil {
		return services.ResolvedManifest{}, err
	}
	shared, err := config.Read(path)
	if err != nil {
		return services.ResolvedManifest{}, err
	}
	if shared.Remote == nil {
		return services.ResolvedManifest{}, &cliout.Failure{
			Err:  fmt.Errorf("remote previews are not configured in %s", path),
			Hint: "Configure the [remote] table in the devhost machine config before starting with --remote.",
		}
	}
	return services.ResolveRemoteServicePorts(value, requested, *shared.Remote)
}

func runRemoteWorker(stateDirectory string, stderr io.Writer) int {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	if err := remote.RunWorker(ctx, stateDirectory); err != nil {
		return fail(stderr, err)
	}
	return 0
}
