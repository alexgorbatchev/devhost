// Package remote connects explicitly shared devhost routes to an authenticated
// relay. The connector belongs to the machine; each stack owns a separate lease.
package remote

import (
	"fmt"
	"io"
	"net"
	"os"
	"strings"
)

type Settings struct {
	ServerURL      string `json:"serverURL"`
	CredentialFile string `json:"credentialFile"`
	Fingerprint    string `json:"fingerprint"`
	RemotePort     int    `json:"remotePort"`
	DomainSuffix   string `json:"domainSuffix"`
}

// Backend names the machine's Caddy listener, independently of public HTTPS.
type Backend struct {
	Scheme              string `json:"scheme"`
	Address             string `json:"address"`
	RootCertificatePath string `json:"rootCertificatePath,omitempty"`
}

type Options struct {
	StateDirectory string
	ManifestPath   string
	Settings       Settings
	Hosts          []string
	Backend        Backend
}

func readCredentials(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("open remote credential file: %w", err)
	}
	defer f.Close() // Read-only file; the read below owns any actionable error.
	info, err := f.Stat()
	if err != nil {
		return "", fmt.Errorf("inspect remote credential file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return "", fmt.Errorf("remote credential file must be a regular file readable only by its owner (mode 0600)")
	}
	if info.Size() > 4096 {
		return "", fmt.Errorf("remote credential file is larger than 4096 bytes")
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil {
		return "", fmt.Errorf("read remote credential file: %w", err)
	}
	if len(data) > 4096 {
		return "", fmt.Errorf("remote credential file is larger than 4096 bytes")
	}
	auth := strings.TrimSpace(string(data))
	user, password, ok := strings.Cut(auth, ":")
	if !ok || user == "" || password == "" || strings.ContainsAny(auth, "\r\n\x00") {
		return "", fmt.Errorf("remote credential file must contain one username:password line")
	}
	return auth, nil
}

func validateOptions(options Options) error {
	if options.StateDirectory == "" || options.ManifestPath == "" {
		return fmt.Errorf("remote previews require a state directory and manifest path")
	}
	if options.Settings.ServerURL == "" || options.Settings.Fingerprint == "" || options.Settings.RemotePort < 1 || options.Settings.RemotePort > 65535 {
		return fmt.Errorf("remote previews require a server URL, pinned fingerprint, and reverse port")
	}
	if len(options.Hosts) == 0 {
		return fmt.Errorf("remote previews require at least one routed hostname")
	}
	for _, host := range options.Hosts {
		if host == "" || strings.ContainsAny(host, "/: \t\r\n") || host != strings.ToLower(host) {
			return fmt.Errorf("invalid remote preview hostname %q", host)
		}
	}
	if options.Backend.Scheme != "http" && options.Backend.Scheme != "https" {
		return fmt.Errorf("remote preview backend must use HTTP or HTTPS")
	}
	host, _, err := net.SplitHostPort(options.Backend.Address)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		return fmt.Errorf("remote preview backend must be a loopback IP address and port")
	}
	if options.Backend.Scheme == "https" && options.Backend.RootCertificatePath == "" {
		return fmt.Errorf("remote HTTPS preview backend requires the Caddy root certificate")
	}
	_, err = readCredentials(options.Settings.CredentialFile)
	return err
}
