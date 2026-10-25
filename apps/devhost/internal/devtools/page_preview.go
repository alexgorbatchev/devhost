package devtools

import (
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/files"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const pagePreviewPath = controlPathPrefix + "/pages/"

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
		document, err := statuspage.Render(statuspage.Page{Kind: "previews", Status: http.StatusOK, Title: "Standalone page previews", Message: "Examples use the real page components with sample data. Preview actions cannot change running services."}, "")
		if err != nil {
			http.Error(w, "Unable to render preview gallery", http.StatusInternalServerError)
			return
		}
		servePreviewDocument(w, r, document, http.StatusOK)
	case "status.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		if r.Method != http.MethodHead {
			_, _ = io.WriteString(w, statuspage.PageCSS) // Delivery is best-effort.
		}
	case "route-not-found", "route-not-found-empty":
		var routes []statuspage.RouteLink
		if name == "route-not-found" {
			routes = []statuspage.RouteLink{
				{Host: "web.localhost", URL: pagePreviewPath + "files/"},
				{Host: "api.localhost", URL: pagePreviewPath + "500"},
			}
		}
		document, err := statuspage.NotFoundPage(routes, pagePreviewPath+"status.css")
		if err != nil {
			http.Error(w, "Unable to render preview", http.StatusInternalServerError)
			return
		}
		servePreviewDocument(w, r, document, http.StatusNotFound)
	case "backend-unavailable":
		document, err := renderUnavailableDocument()
		if err != nil {
			http.Error(w, "Unable to render preview", http.StatusInternalServerError)
			return
		}
		servePreviewDocument(w, r, document, http.StatusBadGateway)
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
