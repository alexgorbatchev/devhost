package devtools

import "net/http"

const (
	reduxMonitorPath            = controlPathPrefix + "/redux"
	reduxRegistrationScriptPath = controlPathPrefix + "/redux.js"
	reduxMonitorScriptPath      = controlPathPrefix + "/redux-monitor.js"
	reduxMonitorStylesheetPath  = controlPathPrefix + "/redux-monitor.css"
	textJavascriptContentType   = "text/javascript; charset=utf-8"
	textHTMLContentType         = "text/html; charset=utf-8"
	reduxMonitorDocument        = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redux DevTools</title><link rel="stylesheet" href="/__devhost__/redux-monitor.css"><style>html,body,#redux-monitor{height:100%;margin:0}</style></head><body><div id="redux-monitor"></div><script type="module" src="/__devhost__/redux-monitor.js"></script></body></html>`
)

func (s *ControlServer) handleReduxMonitor(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	w.Header().Set("Content-Type", textHTMLContentType)
	_, _ = w.Write([]byte(reduxMonitorDocument)) // Response failures cannot be recovered after writing headers.
}

func (s *ControlServer) handleReduxRegistrationScript(w http.ResponseWriter, r *http.Request) {
	s.serveReduxAsset(w, r, "redux.js", textJavascriptContentType)
}

func (s *ControlServer) handleReduxMonitorScript(w http.ResponseWriter, r *http.Request) {
	s.serveReduxAsset(w, r, "redux-monitor.js", textJavascriptContentType)
}

func (s *ControlServer) handleReduxMonitorStylesheet(w http.ResponseWriter, r *http.Request) {
	s.serveReduxAsset(w, r, "redux-monitor.css", textCSSContentType)
}

func (s *ControlServer) serveReduxAsset(w http.ResponseWriter, r *http.Request, filename, contentType string) {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	if !allowAssetMethod(w, r) {
		return
	}
	if s.devSource != nil {
		// The public registration module can load before injection, so it also participates in native source rebuilding.
		content, compressed, err := s.checkAndBuildAssets(filename)
		if err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		serveAsset(w, r, assetResponse{name: filename, contentType: contentType, cacheControl: cacheControlNoStore, content: content, compressed: compressed})
		return
	}
	content, compressed, err := s.readAsset(filename)
	if err != nil {
		http.Error(w, "Redux asset unavailable", http.StatusInternalServerError)
		return
	}
	serveVersionedAsset(w, r, assetResponse{name: filename, contentType: contentType, content: content, compressed: compressed})
}
