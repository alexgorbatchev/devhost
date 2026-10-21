package devtools

import (
	_ "embed"
	"encoding/json"
	"html/template"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/files"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const pagePreviewPath = controlPathPrefix + "/pages/"

//go:embed page_preview.html
var pagePreviewDocument string

var pagePreviewTemplate = template.Must(template.New("page-previews").Parse(pagePreviewDocument))

type pagePreviewData struct {
	Styles      template.CSS
	ThemeScript template.JS
}

func (s *ControlServer) handlePagePreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	name := strings.TrimPrefix(r.URL.Path, pagePreviewPath)
	state, status, isRecovery := pagePreviewState(name)
	if r.Method == http.MethodPost && isRecovery {
		http.Error(w, "Preview only. Restart and worktree actions do not affect running services.", http.StatusConflict)
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if isRecovery {
		switch r.Header.Get(recoveryHeader) {
		case "status", "worktrees":
			w.Header().Set("Content-Type", "application/json")
			if r.Method != http.MethodHead {
				_ = json.NewEncoder(w).Encode(state) // Delivery to a disconnected preview tab is best-effort.
			}
			return
		case "", "probe":
			serveRecoveryPage(w, r, state, status, false)
		default:
			http.Error(w, "Unknown preview action", http.StatusBadRequest)
		}
		return
	}
	if strings.HasPrefix(name, "files/") {
		s.serveFilePreview(w, r)
		return
	}
	switch name {
	case "":
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if r.Method != http.MethodHead {
			data := pagePreviewData{Styles: template.CSS(statuspage.CSS), ThemeScript: template.JS(statuspage.ThemeScript)}
			_ = pagePreviewTemplate.Execute(w, data) // Static embedded template; delivery is best-effort.
		}
	case "status.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		if r.Method != http.MethodHead {
			_, _ = io.WriteString(w, statuspage.CSS) // Delivery is best-effort.
		}
	case "route-not-found", "route-not-found-empty":
		var routes []statuspage.RouteLink
		if name == "route-not-found" {
			routes = []statuspage.RouteLink{
				{Host: "web.localhost", URL: pagePreviewPath + "files/"},
				{Host: "api.localhost", URL: pagePreviewPath + "500"},
			}
		}
		servePreviewDocument(w, r, statuspage.NotFoundPage(routes, pagePreviewPath+"status.css"), http.StatusNotFound)
	case "backend-unavailable":
		servePreviewDocument(w, r, renderUnavailableDocument(), http.StatusBadGateway)
	default:
		http.NotFound(w, r)
	}
}

func servePreviewDocument(w http.ResponseWriter, r *http.Request, document string, status int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = io.WriteString(w, document) // Delivery to a disconnected preview tab is best-effort.
	}
}

func (s *ControlServer) serveFilePreview(w http.ResponseWriter, r *http.Request) {
	handler, err := files.Open(filepath.Join(s.devSource.RootPath(), "demos", "pages", "files"))
	if err != nil {
		http.Error(w, "Could not open the checkout's demos/pages/files preview directory", http.StatusInternalServerError)
		return
	}
	defer handler.Close() // Preview files are read-only.
	http.StripPrefix(pagePreviewPath+"files", handler).ServeHTTP(w, r)
}
