package devtools

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

type configEditorFixture struct {
	server       *ControlServer
	manifestPath string
	includePath  string
	configPath   string
	checked      [][]byte
}

func startConfigEditorServer(t *testing.T, enabled bool, check func(string, []byte) error) *configEditorFixture {
	t.Helper()
	directory := t.TempDir()
	f := &configEditorFixture{
		manifestPath: filepath.Join(directory, "devhost.toml"),
		includePath:  filepath.Join(directory, "api.toml"),
		configPath:   filepath.Join(directory, "config", "config.toml"),
	}
	if err := os.WriteFile(f.manifestPath, []byte("name = \"stack\"\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	// The umask can narrow the mode a file is created with.
	if err := os.Chmod(f.manifestPath, 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.includePath, []byte("[services.api]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	server, err := StartControlServer(StartControlServerOptions{
		FeatureToggles:    FeatureToggles{ConfigEditorEnabled: enabled},
		GetHealthResponse: func() (HealthResponse, error) { return HealthResponse{Services: []ServiceHealth{}}, nil },
		ListConfigFiles: func() ([]ConfigFileRef, error) {
			return []ConfigFileRef{
				{Path: f.manifestPath, Kind: ConfigFileKindManifest},
				{Path: f.includePath, Kind: ConfigFileKindInclude},
				{Path: f.configPath, Kind: ConfigFileKindConfig},
			}, nil
		},
		CheckConfigFile: func(path string, content []byte) error {
			f.checked = append(f.checked, content)
			if check == nil {
				return nil
			}
			return check(path, content)
		},
		ProjectRootPath: directory,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := server.Stop(); err != nil {
			t.Errorf("stop config editor server: %v", err)
		}
	})
	f.server = server
	return f
}

func (f *configEditorFixture) do(t *testing.T, method, path string, body any, header http.Header) (int, []byte) {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			t.Fatal(err)
		}
	}
	request, err := http.NewRequest(method, serverURL(f.server.Port(), path), bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", jsonMediaType)
	}
	for name, values := range header {
		request.Header[name] = values
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var buffer bytes.Buffer
	if _, err := buffer.ReadFrom(response.Body); err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, buffer.Bytes()
}

func contentVersion(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func decodeJSON[T any](t *testing.T, body []byte) T {
	t.Helper()
	var value T
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return value
}

func TestConfigFilesListsEveryEditableFileWithItsVersion(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	status, body := f.do(t, http.MethodGet, configFilesPath, nil, nil)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %s", status, body)
	}
	got := decodeJSON[configFileListResponse](t, body).Files
	want := []configFile{
		{Path: f.manifestPath, Kind: ConfigFileKindManifest, Content: "name = \"stack\"\n", Version: contentVersion("name = \"stack\"\n")},
		{Path: f.includePath, Kind: ConfigFileKindInclude, Content: "[services.api]\n", Version: contentVersion("[services.api]\n")},
		{Path: f.configPath, Kind: ConfigFileKindConfig},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("files = %#v, want %#v", got, want)
	}
}

func TestConfigSaveWritesCheckedContentInPlace(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	target := filepath.Join(filepath.Dir(f.manifestPath), "shared.toml")
	if err := os.Rename(f.includePath, target); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, f.includePath); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, path, written, base string
		mode                      os.FileMode
	}{
		{"the manifest keeps its mode", f.manifestPath, f.manifestPath, contentVersion("name = \"stack\"\n"), 0o640},
		{"a linked include is written through the link", f.includePath, target, contentVersion("[services.api]\n"), 0o600},
		{"a missing config file is created", f.configPath, f.configPath, "", 0o600},
	} {
		t.Run(tc.name, func(t *testing.T) {
			content := "# saved\n"
			status, body := f.do(t, http.MethodPost, configSavePath, configSaveRequest{Path: tc.path, Content: content, BaseVersion: tc.base}, nil)
			if status != http.StatusOK {
				t.Fatalf("status = %d: %s", status, body)
			}
			if got := decodeJSON[configSaveResponse](t, body).Version; got != contentVersion(content) {
				t.Fatalf("version = %q, want the version of the saved content", got)
			}
			saved, err := os.ReadFile(tc.written)
			if err != nil || string(saved) != content {
				t.Fatalf("%s holds %q, %v; want %q", tc.written, saved, err, content)
			}
			info, err := os.Stat(tc.written)
			if err != nil || info.Mode().Perm() != tc.mode {
				t.Fatalf("mode = %v, %v; want %v", info.Mode().Perm(), err, tc.mode)
			}
		})
	}
	if info, err := os.Lstat(f.includePath); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("saving through a link replaced the link: %v, %v", info.Mode(), err)
	}
}

func TestConfigSaveRefusesAFileChangedSinceItWasOpened(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	status, body := f.do(t, http.MethodPost, configSavePath, configSaveRequest{Path: f.manifestPath, Content: "name = \"mine\"\n", BaseVersion: contentVersion("name = \"older\"\n")}, nil)
	if status != http.StatusConflict {
		t.Fatalf("status = %d: %s", status, body)
	}
	current := decodeJSON[configFile](t, body)
	if current.Content != "name = \"stack\"\n" || current.Version != contentVersion(current.Content) {
		t.Fatalf("conflict returned %#v, want the file on disk", current)
	}
	if len(f.checked) != 0 {
		t.Fatal("a conflicting save was checked")
	}
}

func TestConfigSaveRefusesContentThatFailsTheChecks(t *testing.T) {
	f := startConfigEditorServer(t, true, func(string, []byte) error {
		return &manifest.ValidationError{Heading: "Manifest schema is invalid", Issues: []string{`services.api Unrecognized key: "unknown"`}}
	})
	status, body := f.do(t, http.MethodPost, configSavePath, configSaveRequest{Path: f.includePath, Content: "[services.api]\nunknown = 1\n", BaseVersion: contentVersion("[services.api]\n")}, nil)
	if status != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d: %s", status, body)
	}
	issues := decodeJSON[configIssuesResponse](t, body).Issues
	if !slices.Equal(issues, []configIssue{{Message: `services.api Unrecognized key: "unknown"`, KeyPath: "services.api.unknown"}}) {
		t.Fatalf("issues = %#v", issues)
	}
	if saved, err := os.ReadFile(f.includePath); err != nil || string(saved) != "[services.api]\n" {
		t.Fatalf("refused content was written: %q, %v", saved, err)
	}
}

func TestConfigEditorRefusesFilesItDoesNotList(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	outside := filepath.Join(t.TempDir(), "devhost.toml")
	for _, tc := range []struct {
		path string
		body any
	}{
		{configValidatePath, configValidateRequest{Path: outside, Content: "name = \"x\"\n"}},
		{configSavePath, configSaveRequest{Path: outside, Content: "name = \"x\"\n"}},
	} {
		if status, body := f.do(t, http.MethodPost, tc.path, tc.body, nil); status != http.StatusForbidden {
			t.Fatalf("POST %s status = %d: %s", tc.path, status, body)
		}
	}
	if _, err := os.Stat(outside); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("an unlisted file was written: %v", err)
	}
}

func TestConfigSaveOnlyAcceptsClientsOnThisMachine(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	for _, tc := range []struct {
		name      string
		forwarded []string
		want      int
	}{
		{"a client on another machine", []string{"192.0.2.10"}, http.StatusForbidden},
		{"a chain through another machine", []string{"127.0.0.1, 192.0.2.10"}, http.StatusForbidden},
		{"a browser on this machine", []string{"::1"}, http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			current, err := os.ReadFile(f.manifestPath)
			if err != nil {
				t.Fatal(err)
			}
			request := configSaveRequest{Path: f.manifestPath, Content: "name = \"saved\"\n", BaseVersion: contentVersion(string(current))}
			if status, body := f.do(t, http.MethodPost, configSavePath, request, http.Header{"X-Forwarded-For": tc.forwarded}); status != tc.want {
				t.Fatalf("status = %d, want %d: %s", status, tc.want, body)
			}
		})
	}
}

func TestConfigEditorRoutesFollowTheToggle(t *testing.T) {
	f := startConfigEditorServer(t, false, nil)
	for _, path := range []string{configFilesPath, configSchemaPath} {
		if status, _ := f.do(t, http.MethodGet, path, nil, nil); status != http.StatusNotFound {
			t.Fatalf("GET %s with the editor off = %d, want 404", path, status)
		}
	}
	settings := f.server.currentSettings()
	settings.FeatureToggles.ConfigEditorEnabled = true
	if err := f.server.UpdateSettings(settings); err != nil {
		t.Fatal(err)
	}
	if status, body := f.do(t, http.MethodGet, configFilesPath, nil, nil); status != http.StatusOK {
		t.Fatalf("status after turning the editor on = %d: %s", status, body)
	}
}

func TestConfigFilesCannotBeReadThroughANameReboundToTheControlPort(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	rebound := fmt.Sprintf("rebound.example:%d", f.server.Port())
	for _, path := range []string{configFilesPath, configSchemaPath} {
		request, err := http.NewRequest(http.MethodGet, serverURL(f.server.Port(), path), nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Host = rebound
		request.Header.Set("Sec-Fetch-Site", "same-origin")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if err := response.Body.Close(); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != http.StatusForbidden {
			t.Fatalf("GET %s through %s = %d, want 403", path, rebound, response.StatusCode)
		}
	}
}

func TestConfigSchemaDescribesTheSettingsOfEachFile(t *testing.T) {
	f := startConfigEditorServer(t, true, nil)
	status, body := f.do(t, http.MethodGet, configSchemaPath, nil, nil)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %s", status, body)
	}
	schema := decodeJSON[configSchemaResponse](t, body)
	for _, tc := range []struct {
		name string
		keys []string
		want string
	}{
		{"service settings", schema.Manifest.Tables["services.*"], "lifecycle"},
		{"lifecycle modes", schema.Manifest.Values["services.*.lifecycle.mode"], "daemon"},
		{"editor toggles", schema.Manifest.Tables["devtools"], "configEditor"},
		{"Caddy listeners", schema.Config.Tables["caddy"], "httpsPort"},
		{"Caddy bind hosts", schema.Config.Values["caddy.bindHost"], "0.0.0.0"},
	} {
		if !slices.Contains(tc.keys, tc.want) {
			t.Errorf("%s = %v, want %q", tc.name, tc.keys, tc.want)
		}
	}
	if slices.Contains(schema.Manifest.Tables[""], "caddy") {
		t.Error("the manifest schema offers caddy, which manifests no longer accept")
	}
}

func TestConfigIssuesLocateEachProblem(t *testing.T) {
	directory := t.TempDir()
	manifestPath := filepath.Join(directory, "devhost.toml")
	if err := os.WriteFile(manifestPath, []byte("name = \"stack\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_, parseError := manifest.ReadManifestWithOverrides(manifestPath, map[string][]byte{manifestPath: []byte("name = \"stack\"\nport = [\n")})
	_, configParseError := config.Parse("config.toml", []byte("[caddy\n"))
	for _, tc := range []struct {
		name string
		err  error
		want []configIssue
	}{
		{"a manifest syntax error", parseError, []configIssue{{Message: parseError.Error(), Path: manifestPath, Line: 2, Column: 9}}},
		{"a config syntax error", configParseError, []configIssue{{Message: configParseError.Error(), Line: 2, Column: 7}}},
		{"manifest settings", &manifest.ValidationError{Heading: "Manifest schema is invalid", Issues: []string{
			`manifest Unrecognized key: "extra"`,
			`services.api.port must be an integer between 1 and 65535 or "auto".`,
		}}, []configIssue{
			{Message: `manifest Unrecognized key: "extra"`, KeyPath: "extra"},
			{Message: `services.api.port must be an integer between 1 and 65535 or "auto".`, KeyPath: "services.api.port"},
		}},
		{"config settings", &config.ValidationError{Path: "config.toml", Issues: []string{`Unrecognized key: "caddy.port"`, "caddy.httpsPort must be an integer between 1 and 65535."}}, []configIssue{
			{Message: `Unrecognized key: "caddy.port"`, KeyPath: "caddy.port"},
			{Message: "caddy.httpsPort must be an integer between 1 and 65535.", KeyPath: "caddy.httpsPort"},
		}},
		{"a check without a position", errors.New("Dependency cycle detected: api -> api"), []configIssue{{Message: "Dependency cycle detected: api -> api"}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := readConfigIssues(tc.err); !slices.Equal(got, tc.want) {
				t.Fatalf("issues = %#v, want %#v", got, tc.want)
			}
		})
	}
}
