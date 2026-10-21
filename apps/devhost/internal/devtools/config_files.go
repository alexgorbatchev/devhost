package devtools

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/config"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

const (
	configPathPrefix   = controlPathPrefix + "/config/"
	configFilesPath    = configPathPrefix + "files"
	configValidatePath = configPathPrefix + "validate"
	configSavePath     = configPathPrefix + "save"
	configSchemaPath   = configPathPrefix + "schema"
	// configContentLimit bounds one file in a request; a manifest is a few kilobytes.
	configContentLimit = 1 << 20
	// newConfigFileMode is the mode of a config file a save creates.
	newConfigFileMode os.FileMode = 0o600
)

// ConfigFileKind is the role an editable file has in the stack's configuration.
type ConfigFileKind string

const (
	ConfigFileKindManifest ConfigFileKind = "manifest"
	ConfigFileKindInclude  ConfigFileKind = "include"
	ConfigFileKindConfig   ConfigFileKind = "config"
)

// ConfigFileRef names a file the config editor may change.
type ConfigFileRef struct {
	Path string
	Kind ConfigFileKind
}

type configFile struct {
	Path    string         `json:"path"`
	Kind    ConfigFileKind `json:"kind"`
	Content string         `json:"content"`
	// Version identifies the content on disk; it is empty for a file that does not exist.
	Version string `json:"version"`
}

type configFileListResponse struct {
	Files []configFile `json:"files"`
}

type configValidateRequest struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type configSaveRequest struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	BaseVersion string `json:"baseVersion"`
}

type configSaveResponse struct {
	Version string `json:"version"`
}

// configIssue is one reason content cannot be applied. Path names the file it is in when that is not the file being
// checked; Line and Column are zero without a position, and KeyPath is empty when the issue names no setting.
type configIssue struct {
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
	Line    int    `json:"line,omitempty"`
	Column  int    `json:"column,omitempty"`
	KeyPath string `json:"keyPath,omitempty"`
}

// configSchemaResponse describes the settings of each kind of file, for completion.
type configSchemaResponse struct {
	Manifest manifest.Schema `json:"manifest"`
	Config   config.Schema   `json:"config"`
}

type configIssuesResponse struct {
	Issues []configIssue `json:"issues"`
}

func (s *ControlServer) isConfigEditorAvailable() bool {
	return s.currentSettings().FeatureToggles.ConfigEditorEnabled && s.listConfigFiles != nil && s.checkConfigFile != nil
}

func (s *ControlServer) handleConfigFiles(writer http.ResponseWriter, request *http.Request) {
	if !s.isConfigEditorAvailable() {
		http.NotFound(writer, request)
		return
	}
	refs, err := s.listConfigFiles()
	if err != nil {
		http.Error(writer, err.Error(), http.StatusServiceUnavailable)
		return
	}
	files := make([]configFile, 0, len(refs))
	for _, ref := range refs {
		file, err := readConfigFile(ref)
		if err != nil {
			http.Error(writer, err.Error(), http.StatusInternalServerError)
			return
		}
		files = append(files, file)
	}
	writeJSONResponse(writer, http.StatusOK, configFileListResponse{Files: files})
}

func (s *ControlServer) handleConfigSchema(writer http.ResponseWriter, request *http.Request) {
	if !s.isConfigEditorAvailable() {
		http.NotFound(writer, request)
		return
	}
	writeJSONResponse(writer, http.StatusOK, configSchemaResponse{Manifest: manifest.ReadSchema(), Config: config.ReadSchema()})
}

func (s *ControlServer) handleConfigValidate(writer http.ResponseWriter, request *http.Request) {
	if !s.isConfigEditorAvailable() {
		http.NotFound(writer, request)
		return
	}
	var payload configValidateRequest
	if !decodeConfigRequest(writer, request, &payload) {
		return
	}
	if _, ok := s.findConfigFile(writer, payload.Path); !ok {
		return
	}
	writeJSONResponse(writer, http.StatusOK, configIssuesResponse{Issues: readConfigIssues(s.checkConfigFile(payload.Path, []byte(payload.Content)))})
}

// handleConfigSave writes content that passes the checks a reload makes. The manifest watcher then applies it, so a
// save starts no reload of its own.
func (s *ControlServer) handleConfigSave(writer http.ResponseWriter, request *http.Request) {
	if !s.isConfigEditorAvailable() {
		http.NotFound(writer, request)
		return
	}
	// A manifest sets the commands services run, so only a browser on this machine may write one, even when Caddy
	// listens on every interface.
	if !isLocalClient(request) {
		http.Error(writer, "Only a browser on this machine can save the configuration.", http.StatusForbidden)
		return
	}
	var payload configSaveRequest
	if !decodeConfigRequest(writer, request, &payload) {
		return
	}
	ref, ok := s.findConfigFile(writer, payload.Path)
	if !ok {
		return
	}
	s.configSaveMu.Lock()
	defer s.configSaveMu.Unlock()
	current, err := readConfigFile(ref)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	if current.Version != payload.BaseVersion {
		writeJSONResponse(writer, http.StatusConflict, current)
		return
	}
	if issues := readConfigIssues(s.checkConfigFile(payload.Path, []byte(payload.Content))); len(issues) > 0 {
		writeJSONResponse(writer, http.StatusUnprocessableEntity, configIssuesResponse{Issues: issues})
		return
	}
	if err := writeConfigFile(payload.Path, []byte(payload.Content)); err != nil {
		http.Error(writer, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSONResponse(writer, http.StatusOK, configSaveResponse{Version: readContentVersion([]byte(payload.Content))})
}

func decodeConfigRequest(writer http.ResponseWriter, request *http.Request, payload any) bool {
	if request.Method != http.MethodPost {
		writer.Header().Set("Allow", http.MethodPost)
		http.Error(writer, "Method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	// Content travels as a JSON string, which can escape each byte in up to six.
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 6*configContentLimit+4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(payload); err != nil {
		http.Error(writer, "Invalid configuration payload.", http.StatusBadRequest)
		return false
	}
	return true
}

// findConfigFile accepts only a path the stack lists as editable.
func (s *ControlServer) findConfigFile(writer http.ResponseWriter, path string) (ConfigFileRef, bool) {
	refs, err := s.listConfigFiles()
	if err != nil {
		http.Error(writer, err.Error(), http.StatusServiceUnavailable)
		return ConfigFileRef{}, false
	}
	for _, ref := range refs {
		if ref.Path == path {
			return ref, true
		}
	}
	http.Error(writer, "The configuration editor cannot change this file.", http.StatusForbidden)
	return ConfigFileRef{}, false
}

func readConfigFile(ref ConfigFileRef) (configFile, error) {
	file := configFile{Path: ref.Path, Kind: ref.Kind}
	content, err := os.ReadFile(ref.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return file, nil
	}
	if err != nil {
		return configFile{}, err
	}
	if len(content) > configContentLimit {
		return configFile{}, errors.New("the file is too large for the configuration editor: " + ref.Path)
	}
	file.Content, file.Version = string(content), readContentVersion(content)
	return file, nil
}

func readContentVersion(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// writeConfigFile replaces the file at path atomically. A link is followed so it keeps pointing at the saved file,
// and an existing file keeps its mode.
func writeConfigFile(path string, content []byte) error {
	target, err := filepath.EvalSymlinks(path)
	if errors.Is(err, fs.ErrNotExist) {
		target = path
	} else if err != nil {
		return err
	}
	mode := newConfigFileMode
	if info, err := os.Stat(target); err == nil {
		mode = info.Mode().Perm()
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := writeFileDurably(target, content, mode); err != nil {
		return err
	}
	// The temporary file is created with mode filtered by the umask; set it exactly.
	return os.Chmod(target, mode)
}

// isLocalClient reports whether the request came from this machine. The control server listens on loopback, and
// Caddy replaces any X-Forwarded-For a client sends with the address it accepted the connection from.
func isLocalClient(request *http.Request) bool {
	if !isLoopbackAddress(request.RemoteAddr) {
		return false
	}
	for _, header := range request.Header.Values("X-Forwarded-For") {
		for _, address := range strings.Split(header, ",") {
			if !isLoopbackAddress(strings.TrimSpace(address)) {
				return false
			}
		}
	}
	return true
}

func isLoopbackAddress(address string) bool {
	if host, _, err := net.SplitHostPort(address); err == nil {
		address = host
	}
	ip := net.ParseIP(address)
	return ip != nil && ip.IsLoopback()
}

// readConfigIssues turns the error of a configuration check into the issues the editor shows, with the position of
// a syntax error and the setting each validation issue names.
func readConfigIssues(err error) []configIssue {
	if err == nil {
		return []configIssue{}
	}
	var manifestParseError *manifest.ParseError
	if errors.As(err, &manifestParseError) {
		return []configIssue{{Message: err.Error(), Path: manifestParseError.Path, Line: manifestParseError.Line, Column: manifestParseError.Column}}
	}
	var tomlParseError toml.ParseError
	if errors.As(err, &tomlParseError) {
		return []configIssue{{Message: err.Error(), Line: tomlParseError.Position.Line, Column: tomlParseError.Position.Col}}
	}
	var manifestValidationError *manifest.ValidationError
	if errors.As(err, &manifestValidationError) {
		return readValidationIssues(manifestValidationError.Issues, manifest.IssueKeyPath)
	}
	var configValidationError *config.ValidationError
	if errors.As(err, &configValidationError) {
		return readValidationIssues(configValidationError.Issues, config.IssueKeyPath)
	}
	return []configIssue{{Message: err.Error()}}
}

func readValidationIssues(messages []string, readKeyPath func(string) string) []configIssue {
	issues := make([]configIssue, 0, len(messages))
	for _, message := range messages {
		issues = append(issues, configIssue{Message: message, KeyPath: readKeyPath(message)})
	}
	return issues
}

func writeJSONResponse(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", jsonMediaType)
	writer.Header().Set("Cache-Control", cacheControlNoStore)
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value) // The client may have gone; nothing is left to report to.
}
