package config

import (
	"errors"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const validRemoteConfig = `[remote]
serverURL = "https://relay.example.com"
credentialFile = "relay.auth"
fingerprint = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
remotePort = 18081
domainSuffix = "--laptop--preview.example.com"
`

func TestRemoteConfigEditorCompletions(t *testing.T) {
	t.Parallel()
	schema := ReadSchema()
	if !slices.Contains(schema.Tables[""], "remote") {
		t.Fatal("machine config completion is missing the remote table")
	}
	want := []string{"serverURL", "credentialFile", "fingerprint", "remotePort", "domainSuffix", "localSuffix"}
	if !slices.Equal(schema.Tables["remote"], want) {
		t.Fatalf("remote setting completions = %v, want %v", schema.Tables["remote"], want)
	}
}

func TestParseRemoteConfig(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "config.toml")
	got, err := Parse(path, []byte(validRemoteConfig))
	if err != nil {
		t.Fatal(err)
	}
	if got.Remote == nil || got.Remote.ServerURL != "https://relay.example.com" || got.Remote.LocalSuffix != ".localhost" || got.Remote.DomainSuffix != "--laptop--preview.example.com" || got.Remote.RemotePort != 18081 || got.Remote.CredentialFile != filepath.Join(filepath.Dir(path), "relay.auth") {
		t.Fatalf("remote settings = %#v", got.Remote)
	}

	got, err = Parse(path, []byte(strings.ReplaceAll(validRemoteConfig, `credentialFile = "relay.auth"`, `credentialFile = "/private/relay.auth"`)+"localSuffix = \" --Workstation.Example.COM \"\n"))
	if err != nil || got.Remote.LocalSuffix != "--workstation.example.com" || got.Remote.CredentialFile != "/private/relay.auth" {
		t.Fatalf("custom remote settings = %#v, %v", got.Remote, err)
	}

	got, err = Parse(path, nil)
	if err != nil || got.Remote != nil {
		t.Fatalf("unconfigured remote = %#v, %v", got.Remote, err)
	}
}

func TestParseRejectsInvalidRemoteConfig(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct{ name, from, to, want string }{
		{"plaintext remote", "https://relay.example.com", "http://relay.example.com", "remote.serverURL"},
		{"URL credential", "https://relay.example.com", "https://user:secret@relay.example.com", "remote.serverURL"},
		{"URL query", "https://relay.example.com", "https://relay.example.com?secret=value", "remote.serverURL"},
		{"URL fragment", "https://relay.example.com", "https://relay.example.com#value", "remote.serverURL"},
		{"empty credential path", "relay.auth", "", "remote.credentialFile"},
		{"short fingerprint", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "AAAA", "remote.fingerprint"},
		{"invalid fingerprint", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", "not-base64", "remote.fingerprint"},
		{"missing port", "18081", "0", "remote.remotePort"},
		{"port too large", "18081", "65536", "remote.remotePort"},
		{"host without separator", "--laptop--preview.example.com", "preview.example.com", "remote.domainSuffix"},
		{"wildcard host", "--laptop--preview.example.com", ".*.example.com", "remote.domainSuffix"},
		{"unknown property", "remotePort", "remote-port", "Unrecognized key"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := Parse("config.toml", []byte(strings.ReplaceAll(validRemoteConfig, tc.from, tc.to)))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("parse error = %v, want %s", err, tc.want)
			}
		})
	}
	_, err := Parse("config.toml", []byte("[remote]\nlocalSuffix = \"\"\n"))
	var validation *ValidationError
	if !errors.As(err, &validation) || len(validation.Issues) != 6 {
		t.Fatalf("incomplete remote config issues = %v", err)
	}
}

func TestRelayURLValidation(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		url   string
		valid bool
	}{
		{"https://relay.example.com/connect", true},
		{"https://relay.example.com:443", true},
		{"http://localhost:8080", true},
		{"http://127.0.0.1:8080", true},
		{"http://[::1]:8080", true},
		{"http://10.0.0.1:8080", false},
		{"https://relay.example.com:0", false},
		{"https://relay.example.com:65536", false},
		{"https://relay.example.com:nope", false},
		{"https://relay.example.com?", false},
		{"https:relay.example.com", false},
		{"wss://relay.example.com", false},
		{"", false},
	} {
		t.Run(tc.url, func(t *testing.T) {
			if got := validRelayURL(tc.url); got != tc.valid {
				t.Fatalf("validRelayURL(%q) = %v", tc.url, got)
			}
		})
	}
}
