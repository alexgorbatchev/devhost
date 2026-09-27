package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/version"
)

func Run(rawArguments []string, cwd string, stdout io.Writer, stderr io.Writer) int {
	if cli.HasHelpFlag(rawArguments) {
		_, _ = io.WriteString(stdout, cli.HelpText)
		return 0
	}

	arguments, err := cli.ParseCommandLineArguments(rawArguments)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
		return 1
	}

	switch arguments.Kind {
	case cli.KindVersion:
		_, _ = fmt.Fprintf(stdout, "%s\n", version.String())
		return 0
	case cli.KindStop:
		manifestPath := arguments.ManifestPath
		if manifestPath == nil {
			resolvedPath, resolveError := manifest.ResolveManifestPath(cwd)
			if resolveError != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", resolveError.Error())
				return 1
			}
			manifestPath = &resolvedPath
		}

		if err := services.StopStack(*manifestPath, readEnvironment(), stdout, stderr); err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		return 0
	case cli.KindManifest:
		manifestPath := arguments.ManifestPath
		if manifestPath == nil {
			resolvedPath, resolveError := manifest.ResolveManifestPath(cwd)
			if resolveError != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", resolveError.Error())
				return 1
			}
			manifestPath = &resolvedPath
		}

		rawManifest, readError := manifest.ReadManifest(*manifestPath)
		if readError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", readError.Error())
			return 1
		}

		validatedManifest, validateError := manifest.ValidateManifest(*manifestPath, rawManifest)
		if validateError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", validateError.Error())
			return 1
		}

		if err := resolveAnnotationTempDir(validatedManifest.Annotation, cwd); err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err)
			return 1
		}

		serviceOrder, orderError := services.ResolveServiceOrder(validatedManifest)
		if orderError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", orderError.Error())
			return 1
		}

		resolvedManifest, resolveError := services.ResolveServicePorts(validatedManifest)
		if resolveError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", resolveError.Error())
			return 1
		}

		var idleTimeout time.Duration
		if arguments.IdleTimeout != "" {
			parsed, err := time.ParseDuration(arguments.IdleTimeout)
			if err != nil {
				_, _ = fmt.Fprintf(stderr, "failed: invalid idle-timeout: %s\n", err.Error())
				return 1
			}
			idleTimeout = parsed
		}

		startOptions := services.StartStackOptions{
			Environment:         readEnvironment(),
			LogWriter:           stdout,
			ServiceStdoutWriter: stdout,
			ServiceStderrWriter: stderr,
			IdleTimeout:         idleTimeout,
		}
		if arguments.Verbose {
			startOptions.CaddyOutputWriters = caddy.RouteCommandOutputWriters{
				StdoutWriter: stdout,
				StderrWriter: stderr,
			}
		}

		exitCode, startError := services.StartStack(&resolvedManifest, serviceOrder, startOptions)
		if startError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", startError.Error())
			return 1
		}

		return exitCode
	case cli.KindCaddyPrintRootCert:
		paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		exitCode, err := caddy.PrintManagedCaddyRootCertificate(stdout, paths)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		return exitCode
	case cli.KindCaddyLifecycle:
		paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		if arguments.Action == cli.CaddyDownload {
			if err := caddy.DownloadCaddy(stderr, runtime.GOOS, runtime.GOARCH, paths, caddy.DownloadDependencies{}); err != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
				return 1
			}

			return 0
		}

		if arguments.Action == cli.CaddyPrivilegedPorts {
			exitCode, err := caddy.ConfigureManagedCaddyPrivilegedPorts(stderr, runtime.GOOS, runtime.GOARCH, paths, caddy.PrivilegedPortsDependencies{})
			if err != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
				return 1
			}

			return exitCode
		}

		fallback := caddy.ManagedCaddyConfigFallback{}
		if arguments.ManifestPath != nil {
			rawManifest, readError := manifest.ReadManifest(*arguments.ManifestPath)
			if readError != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", readError.Error())
				return 1
			}

			validatedManifest, validateError := manifest.ValidateManifest(*arguments.ManifestPath, rawManifest)
			if validateError != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", validateError.Error())
				return 1
			}

			fallback.AdminAddress = validatedManifest.Caddy.Global.AdminAddress
		}

		exitCode, err := caddy.RunManagedCaddyLifecycleCommand(
			caddy.LifecycleAction(arguments.Action),
			stderr,
			paths,
			fallback,
			caddy.ManagedCaddyLifecycleDependencies{RuntimeOS: runtime.GOOS},
		)
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		return exitCode
	case cli.KindCaddyTrustRemote:
		exitCode, err := caddy.TrustManagedCaddyRemoteCertificate(arguments.SSHTarget, stderr, runtime.GOOS, caddy.TrustRemoteDependencies{})
		if err != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", err.Error())
			return 1
		}

		return exitCode
	default:
		_, _ = fmt.Fprintf(stderr, "failed: unsupported command kind: %s\n", arguments.Kind)
		return 1
	}
}

func resolveAnnotationTempDir(annotation manifest.ValidatedAnnotation, cwd string) error {
	if annotation.TempDir == nil {
		return nil
	}
	dir := *annotation.TempDir
	if !filepath.IsAbs(dir) {
		dir = filepath.Join(cwd, dir)
	}
	resolved, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve annotation.tempDir: %w", err)
	}
	// Actions share this pointer so every file handoff uses the startup location.
	*annotation.TempDir = resolved
	return nil
}

func readEnvironment() map[string]string {
	environment := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}

		environment[key] = value
	}

	return environment
}
