package devtools

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"
)

const (
	devtoolsAssetsPath = controlPathPrefix + "/assets/"
	injectedConfigPath = controlPathPrefix + "/config.json"
)

func (s *ControlServer) assetFiles() fs.FS {
	if s.devSource != nil {
		return os.DirFS(s.devSource.assetsDirectoryPath)
	}
	return bundledAssets
}

func (s *ControlServer) readAsset(name string) ([]byte, []byte, error) {
	files := s.assetFiles()
	if s.devSource == nil {
		name = "dist/" + name
	}
	content, err := fs.ReadFile(files, name)
	if err != nil {
		return nil, nil, err
	}
	var compressed []byte
	if path.Ext(name) == ".js" || path.Ext(name) == ".css" {
		compressed, err = fs.ReadFile(files, name+".gz")
		if err != nil && !os.IsNotExist(err) {
			return nil, nil, err
		}
	}
	return content, compressed, nil
}

func (s *ControlServer) handleInjectedConfig(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	configJSON := s.configJSON
	s.mu.Unlock()
	serveAsset(w, r, assetResponse{name: "config.json", contentType: "application/json; charset=utf-8", cacheControl: cacheControlNoStore, content: configJSON})
}

func (s *ControlServer) handleInjectedScript(w http.ResponseWriter, r *http.Request) {
	if !allowAssetMethod(w, r) {
		return
	}
	if s.devSource != nil {
		content, compressed, err := s.checkAndBuildAssets()
		if err != nil {
			content = []byte(formatJSError(err.Error()))
			compressed = nil
		}
		serveAsset(w, r, assetResponse{name: "devtools.js", contentType: applicationJavascriptContentType, cacheControl: cacheControlNoStore, content: content, compressed: compressed})
		return
	}
	content, compressed, err := s.readAsset("devtools.js")
	if err != nil {
		http.Error(w, "Devtools script unavailable", http.StatusInternalServerError)
		return
	}
	serveVersionedAsset(w, r, assetResponse{name: "devtools.js", contentType: applicationJavascriptContentType, content: content, compressed: compressed})
}

func (s *ControlServer) handleXtermStylesheet(w http.ResponseWriter, r *http.Request) {
	content, compressed, err := s.readAsset("xterm.css")
	if err != nil {
		http.Error(w, "Terminal stylesheet unavailable", http.StatusNotFound)
		return
	}
	serveVersionedAsset(w, r, assetResponse{name: "xterm.css", contentType: textCSSContentType, content: content, compressed: compressed})
}

func (s *ControlServer) handleDevtoolsAsset(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	name := strings.TrimPrefix(r.URL.Path, devtoolsAssetsPath)
	if !fs.ValidPath(name) || strings.Contains(name, "/") {
		http.NotFound(w, r)
		return
	}
	var contentType string
	switch path.Ext(name) {
	case ".js":
		contentType = applicationJavascriptContentType
	case ".woff2":
		contentType = "font/woff2"
	default:
		http.NotFound(w, r)
		return
	}
	content, compressed, err := s.readAsset("assets/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	serveAsset(w, r, assetResponse{name: name, contentType: contentType, cacheControl: cacheControlImmutable, content: content, compressed: compressed})
}
