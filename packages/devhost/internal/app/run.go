package app

import (
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"

	"github.com/alexgorbatchev/devhost/packages/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/packages/devhost/internal/cli"
	"github.com/alexgorbatchev/devhost/packages/devhost/internal/manifest"
)

func Run(rawArguments []string, cwd string, stdout io.Writer, stderr io.Writer) int {
	if cli.HasHelpFlag(rawArguments) {
		_, _ = io.WriteString(stdout, cli.HelpText)
		return 0
	}

	arguments, error := cli.ParseCommandLineArguments(rawArguments)
	if error != nil {
		_, _ = fmt.Fprintf(stderr, "failed: %s\n", error.Error())
		return 1
	}

	switch arguments.Kind {
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

		if _, validateError := manifest.ValidateManifest(*manifestPath, rawManifest); validateError != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", validateError.Error())
			return 1
		}

		_, _ = fmt.Fprintln(stderr, "failed: manifest mode is not implemented yet in the Go rewrite.")
		return 1
	case cli.KindCaddyPrintRootCert:
		paths, error := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
		if error != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", error.Error())
			return 1
		}

		exitCode, error := caddy.PrintManagedCaddyRootCertificate(stdout, paths)
		if error != nil {
			_, _ = fmt.Fprintf(stderr, "failed: %s\n", error.Error())
			return 1
		}

		return exitCode
	case cli.KindCaddyLifecycle:
		if arguments.Action == cli.CaddyDownload {
			paths, error := caddy.CreateManagedCaddyPathsFromEnvironment(readEnvironment())
			if error != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", error.Error())
				return 1
			}

			if error := caddy.DownloadCaddy(stderr, runtime.GOOS, runtime.GOARCH, paths, caddy.DownloadDependencies{}); error != nil {
				_, _ = fmt.Fprintf(stderr, "failed: %s\n", error.Error())
				return 1
			}

			return 0
		}

		_, _ = fmt.Fprintf(stderr, "failed: %s is not implemented yet in the Go rewrite.\n", strings.ReplaceAll(string(arguments.Kind), "-", " "))
		return 1
	case cli.KindCaddyTrustRemote:
		_, _ = fmt.Fprintf(stderr, "failed: %s is not implemented yet in the Go rewrite.\n", strings.ReplaceAll(string(arguments.Kind), "-", " "))
		return 1
	default:
		_, _ = fmt.Fprintf(stderr, "failed: unsupported command kind: %s\n", arguments.Kind)
		return 1
	}
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
