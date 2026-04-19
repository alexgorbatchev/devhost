package caddy

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

type DownloadDependencies struct {
	Chmod     func(string, os.FileMode) error
	Client    *http.Client
	MkdirAll  func(string, os.FileMode) error
	WriteFile func(string, []byte, os.FileMode) error
}

func DownloadCaddy(logWriter io.Writer, runtimeOS string, runtimeArch string, paths Paths, dependencies DownloadDependencies) error {
	client := dependencies.Client
	if client == nil {
		client = http.DefaultClient
	}

	mkdirAll := dependencies.MkdirAll
	if mkdirAll == nil {
		mkdirAll = os.MkdirAll
	}

	writeFile := dependencies.WriteFile
	if writeFile == nil {
		writeFile = os.WriteFile
	}

	chmod := dependencies.Chmod
	if chmod == nil {
		chmod = os.Chmod
	}

	targetOS, error := resolveTargetOS(runtimeOS)
	if error != nil {
		return error
	}

	targetArch, error := resolveTargetArchitecture(runtimeArch)
	if error != nil {
		return error
	}

	destinationPath := paths.ExecutablePath
	if targetOS == "windows" {
		destinationPath = filepath.Join(paths.CaddyDirectoryPath, "caddy.exe")
	}

	url := fmt.Sprintf("https://caddyserver.com/api/download?os=%s&arch=%s", targetOS, targetArch)
	if _, error := fmt.Fprintf(logWriter, "Downloading Caddy for %s-%s from %s...\n", targetOS, targetArch, url); error != nil {
		return fmt.Errorf("log caddy download start: %w", error)
	}

	if error := mkdirAll(paths.CaddyDirectoryPath, 0o755); error != nil {
		return fmt.Errorf("create caddy directory %s: %w", paths.CaddyDirectoryPath, error)
	}

	response, error := client.Get(url)
	if error != nil {
		return fmt.Errorf("download caddy: %w", error)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Failed to download Caddy: %d %s", response.StatusCode, response.Status)
	}

	binary, error := io.ReadAll(response.Body)
	if error != nil {
		return fmt.Errorf("read caddy download response: %w", error)
	}

	if error := writeFile(destinationPath, binary, 0o755); error != nil {
		return fmt.Errorf("write caddy binary %s: %w", destinationPath, error)
	}

	if targetOS != "windows" {
		if error := chmod(destinationPath, 0o755); error != nil {
			return fmt.Errorf("chmod caddy binary %s: %w", destinationPath, error)
		}
	}

	if _, error := fmt.Fprintf(logWriter, "Caddy downloaded to %s\n", destinationPath); error != nil {
		return fmt.Errorf("log caddy download success: %w", error)
	}

	return nil
}

func resolveTargetOS(runtimeOS string) (string, error) {
	switch runtimeOS {
	case "darwin":
		return "darwin", nil
	case "linux":
		return "linux", nil
	case "windows", "win32":
		return "windows", nil
	default:
		return "", fmt.Errorf("Unsupported OS: %s", runtimeOS)
	}
}

func resolveTargetArchitecture(runtimeArch string) (string, error) {
	switch runtimeArch {
	case "amd64", "x64":
		return "amd64", nil
	case "arm64":
		return "arm64", nil
	case "arm":
		return "arm", nil
	default:
		return "", fmt.Errorf("Unsupported Architecture: %s", runtimeArch)
	}
}
