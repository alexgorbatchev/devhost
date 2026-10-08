package app

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/cliout"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/services"
)

func Run(rawArguments []string, cwd string, stdout io.Writer, stderr io.Writer) int {
	arguments, err := cli.ParseCommandLineArguments(rawArguments, stdout, stderr)
	if err != nil {
		return fail(stderr, err)
	}

	switch arguments.Kind {
	case cli.KindHelp, cli.KindVersion, cli.KindCompletion, cli.KindSkill:
		return 0
	case cli.KindStop:
		manifestPath, err := resolveManifestPath(arguments.ManifestPath, cwd)
		if err != nil {
			return fail(stderr, err)
		}

		if err := services.StopStack(manifestPath, readEnvironment(), stdout, stderr); err != nil {
			return fail(stderr, err)
		}

		return 0
	case cli.KindStart:
		manifestPath, err := resolveManifestPath(arguments.ManifestPath, cwd)
		if err != nil {
			return fail(stderr, err)
		}

		rawManifest, readError := manifest.ReadManifest(manifestPath)
		if readError != nil {
			return fail(stderr, describeManifestReadError(manifestPath, readError))
		}

		validatedManifest, validateError := manifest.ValidateManifest(manifestPath, rawManifest)
		if validateError != nil {
			return fail(stderr, validateError)
		}

		if err := resolveAnnotationTempDir(validatedManifest.Annotation, cwd); err != nil {
			return fail(stderr, err)
		}

		serviceOrder, orderError := services.ResolveServiceOrder(validatedManifest)
		if orderError != nil {
			return fail(stderr, orderError)
		}

		resolvedManifest, resolveError := services.ResolveServicePorts(validatedManifest)
		if resolveError != nil {
			return fail(stderr, resolveError)
		}

		var idleTimeout time.Duration
		if arguments.IdleTimeout != "" {
			parsed, err := time.ParseDuration(arguments.IdleTimeout)
			if err != nil {
				return fail(stderr, &cliout.Failure{
					Err:     fmt.Errorf("invalid idle-timeout: %w", err),
					Summary: fmt.Sprintf("the idle timeout %q is not a duration", arguments.IdleTimeout),
					Hint:    "Set --idle-timeout or DEVHOST_IDLE_TIMEOUT to a value such as 30s or 1m.",
				})
			}
			idleTimeout = parsed
		}

		startOptions := services.StartStackOptions{
			Configuration:       &validatedManifest,
			Environment:         readEnvironment(),
			LogWriter:           stdout,
			ServiceStdoutWriter: stdout,
			ServiceStderrWriter: stderr,
			IdleTimeout:         idleTimeout,
		}
		if arguments.Debug {
			startOptions.CaddyOutputWriters = caddy.RouteCommandOutputWriters{
				StdoutWriter: stdout,
				StderrWriter: stderr,
			}
		}

		exitCode, startError := services.StartStack(&resolvedManifest, serviceOrder, startOptions)
		if startError != nil {
			return fail(stderr, startError)
		}

		return exitCode
	case cli.KindCaddyPrintRootCert:
		paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
		if err != nil {
			return fail(stderr, err)
		}

		exitCode, err := caddy.PrintManagedCaddyRootCertificate(stdout, paths)
		if err != nil {
			return fail(stderr, err)
		}

		return exitCode
	case cli.KindCaddyLifecycle:
		paths, err := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
		if err != nil {
			return fail(stderr, err)
		}

		if arguments.Action == cli.CaddyDownload {
			if err := caddy.DownloadCaddy(stderr, runtime.GOOS, runtime.GOARCH, paths, caddy.DownloadDependencies{}); err != nil {
				return fail(stderr, err)
			}

			return 0
		}

		if arguments.Action == cli.CaddyPrivilegedPorts {
			exitCode, err := caddy.ConfigureManagedCaddyPrivilegedPorts(stderr, runtime.GOOS, runtime.GOARCH, paths, caddy.PrivilegedPortsDependencies{})
			if err != nil {
				return fail(stderr, err)
			}

			return exitCode
		}

		fallback := caddy.ManagedCaddyConfigFallback{}
		if arguments.ManifestPath != nil {
			rawManifest, readError := manifest.ReadManifest(*arguments.ManifestPath)
			if readError != nil {
				return fail(stderr, describeManifestReadError(*arguments.ManifestPath, readError))
			}

			validatedManifest, validateError := manifest.ValidateManifest(*arguments.ManifestPath, rawManifest)
			if validateError != nil {
				return fail(stderr, validateError)
			}

			fallback = caddy.ManagedCaddyConfigFallback{
				AdminAddress: validatedManifest.Caddy.Global.AdminAddress,
				BindHost:     validatedManifest.Caddy.Global.BindHost,
				HTTPEnabled:  validatedManifest.Caddy.Global.HTTP,
				HTTPPort:     validatedManifest.Caddy.Global.HTTPPort,
				HTTPSPort:    validatedManifest.Caddy.Global.HTTPSPort,
			}
		}

		exitCode, err := caddy.RunManagedCaddyLifecycleCommand(
			caddy.LifecycleAction(arguments.Action),
			stderr,
			paths,
			fallback,
			caddy.ManagedCaddyLifecycleDependencies{RuntimeOS: runtime.GOOS},
		)
		if err != nil {
			return fail(stderr, err)
		}

		return exitCode
	case cli.KindCaddyTrustRemote:
		exitCode, err := caddy.TrustManagedCaddyRemoteCertificate(arguments.SSHTarget, stderr, runtime.GOOS, caddy.TrustRemoteDependencies{})
		if err != nil {
			return fail(stderr, err)
		}

		return exitCode
	default:
		return fail(stderr, fmt.Errorf("unsupported command kind: %s", arguments.Kind))
	}
}

// fail reports err as the reason the command failed and returns the exit code
// for it.
func fail(stderr io.Writer, err error) int {
	cliout.WriteFailure(stderr, err)
	return 1
}

// resolveManifestPath returns the manifest a command names or, when it names
// none, the nearest one in cwd or above it.
func resolveManifestPath(explicitPath *string, cwd string) (string, error) {
	if explicitPath != nil {
		return *explicitPath, nil
	}

	discoveredPath, err := manifest.ResolveManifestPath(cwd)
	if err != nil {
		return "", &cliout.Failure{Err: err, Hint: "Run devhost from your project folder, or pass --manifest <path>."}
	}

	return discoveredPath, nil
}

// describeManifestReadError gives a manifest that does not exist a message that
// names the file once and says where its path came from. Every other read error,
// a missing file the manifest includes among them, is returned as it is.
func describeManifestReadError(manifestPath string, err error) error {
	var pathError *fs.PathError
	if !errors.As(err, &pathError) || !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	absoluteManifestPath, absoluteError := filepath.Abs(manifestPath)
	if absoluteError != nil || pathError.Path != absoluteManifestPath {
		return err
	}

	return &cliout.Failure{
		Err:     err,
		Summary: "manifest file not found: " + absoluteManifestPath,
		Hint:    "Check the path given with --manifest or DEVHOST_MANIFEST.",
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
