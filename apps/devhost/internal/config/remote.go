package config

import (
	"crypto/sha256"
	"encoding/base64"
	"net"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/remote"
)

const defaultLocalSuffix = ".localhost"

type remoteContents struct {
	ServerURL      string  `toml:"serverURL"`
	CredentialFile string  `toml:"credentialFile"`
	Fingerprint    string  `toml:"fingerprint"`
	RemotePort     int     `toml:"remotePort"`
	DomainSuffix   string  `toml:"domainSuffix"`
	LocalSuffix    *string `toml:"localSuffix"`
}

func readRemote(path string, contents remoteContents) (remote.Settings, []string) {
	settings := remote.Settings{
		ServerURL:      strings.TrimSpace(contents.ServerURL),
		CredentialFile: strings.TrimSpace(contents.CredentialFile),
		Fingerprint:    strings.TrimSpace(contents.Fingerprint),
		RemotePort:     contents.RemotePort,
		DomainSuffix:   strings.ToLower(strings.TrimSpace(contents.DomainSuffix)),
		LocalSuffix:    defaultLocalSuffix,
	}
	if contents.LocalSuffix != nil {
		settings.LocalSuffix = strings.ToLower(strings.TrimSpace(*contents.LocalSuffix))
	}
	var issues []string
	if !validRelayURL(settings.ServerURL) {
		issues = append(issues, "remote.serverURL must be an HTTPS relay URL without credentials, a query, or a fragment; HTTP is supported only on loopback.")
	}
	if settings.CredentialFile == "" {
		issues = append(issues, "remote.credentialFile must name a private file containing username:password.")
	} else if !filepath.IsAbs(settings.CredentialFile) {
		settings.CredentialFile = filepath.Join(filepath.Dir(path), settings.CredentialFile)
	}
	fingerprint, err := base64.StdEncoding.Strict().DecodeString(settings.Fingerprint)
	if err != nil || len(fingerprint) != sha256.Size {
		issues = append(issues, "remote.fingerprint must be the relay's complete base64 SHA-256 fingerprint.")
	}
	if settings.RemotePort < 1 || settings.RemotePort > 65535 {
		issues = append(issues, "remote.remotePort must be an integer between 1 and 65535.")
	}
	for _, entry := range []struct{ name, value string }{
		{"domainSuffix", settings.DomainSuffix}, {"localSuffix", settings.LocalSuffix},
	} {
		if !validHostSuffix(entry.value) {
			issues = append(issues, "remote."+entry.name+" must be a hostname suffix beginning with a dot or hyphen.")
		}
	}
	return settings, issues
}

func validRelayURL(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	if port := u.Port(); port != "" {
		parsed, err := strconv.Atoi(port)
		if err != nil || parsed < 1 || parsed > 65535 {
			return false
		}
	}
	if u.Scheme == "https" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	return u.Scheme == "http" && (host == "localhost" || net.ParseIP(host).IsLoopback())
}

func validHostSuffix(suffix string) bool {
	return (strings.HasPrefix(suffix, ".") || strings.HasPrefix(suffix, "-")) && manifest.IsValidHost("preview"+suffix)
}
