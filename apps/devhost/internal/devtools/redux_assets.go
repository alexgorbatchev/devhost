package devtools

import "net/http"

const (
	reduxMonitorPath            = controlPathPrefix + "/redux"
	reduxRegistrationScriptPath = controlPathPrefix + "/redux.js"
	reduxMonitorScriptPath      = controlPathPrefix + "/redux-monitor.js"
	textJavascriptContentType   = "text/javascript; charset=utf-8"
	textHTMLContentType         = "text/html; charset=utf-8"
	reduxMonitorDocument        = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Redux DevTools</title><style>html,body,#redux-monitor{height:100%;margin:0}</style></head><body><div id="redux-monitor"></div><script type="module" src="/__devhost__/redux-monitor.js"></script></body></html>`
)

func (s *ControlServer) handleReduxMonitor(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Cache-Control", cacheControlNoStore)
	w.Header().Set("Content-Type", textHTMLContentType)
	_, _ = w.Write([]byte(reduxMonitorDocument)) // Response failures cannot be recovered after writing headers.
}

func (s *ControlServer) handleReduxRegistrationScript(w http.ResponseWriter, r *http.Request) {
	s.serveReduxScript(w, r, "redux.js")
}

func (s *ControlServer) handleReduxMonitorScript(w http.ResponseWriter, r *http.Request) {
	s.serveReduxScript(w, r, "redux-monitor.js")
}

func (s *ControlServer) serveReduxScript(w http.ResponseWriter, r *http.Request, filename string) {
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
		serveAsset(w, r, assetResponse{name: filename, contentType: textJavascriptContentType, cacheControl: cacheControlNoStore, content: content, compressed: compressed})
		return
	}
	content, compressed, err := s.readAsset(filename)
	if err != nil {
		http.Error(w, "Redux script unavailable", http.StatusInternalServerError)
		return
	}
	serveVersionedAsset(w, r, assetResponse{name: filename, contentType: textJavascriptContentType, content: content, compressed: compressed})
}
