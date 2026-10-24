package devtools

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const recoveryHeader = "X-Devhost-Recovery"

// RecoveryState is the service lifecycle snapshot served independently of the toolbar.
type RecoveryState struct {
	Stack        string               `json:"stack"`
	Service      string               `json:"service"`
	Phase        string               `json:"phase"`
	Title        string               `json:"title"`
	Message      string               `json:"message"`
	Address      string               `json:"address"`
	CanRestart   bool                 `json:"canRestart"`
	Logs         []string             `json:"logs"`
	Repositories []WorktreeRepository `json:"repositories,omitempty"`
}

func serveRecoveryPage(w http.ResponseWriter, r *http.Request, state RecoveryState, status int, injectToolbar bool) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Sec-Fetch-Dest") != "document" && strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(state) // Delivery to a disconnected client is best-effort.
		return
	}
	document, err := renderRecoveryDocument(state, status, injectToolbar)
	if err != nil {
		http.Error(w, "Unable to render service status", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = io.WriteString(w, document) // Delivery to a disconnected client is best-effort.
	}
}

func renderRecoveryDocument(state RecoveryState, status int, injectToolbar bool) (string, error) {
	document, err := statuspage.Render(statuspage.Page{
		Kind: "recovery", Status: status, Title: state.Title, Message: state.Message, Recovery: state,
	}, "")
	if err != nil {
		return "", err
	}
	if injectToolbar {
		document = injectDevtoolsScript(document)
	}
	return document, nil
}

func serveRecoveryControl(w http.ResponseWriter, r *http.Request, options StartDocumentInjectionServerOptions, proxy http.Handler) {
	w.Header().Set("Cache-Control", "no-store")
	// The routed host belongs to the service, not to this stack's routes, so only the cross-origin rule of the control
	// server's guard applies here.
	if err := crossOriginProtection.Check(r); err != nil {
		http.Error(w, err.Error(), http.StatusForbidden)
		return
	}
	switch r.Header.Get(recoveryHeader) {
	case "worktrees":
		if options.Worktrees == nil {
			http.Error(w, "Worktrees are not enabled.", http.StatusNotImplemented)
			return
		}
		options.Worktrees.ServeHTTP(w, r)
	case "status", "probe":
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Use GET for service status", http.StatusMethodNotAllowed)
			return
		}
		state := options.GetRecovery()
		if r.Header.Get(recoveryHeader) == "probe" {
			if state.Phase != "ready" {
				serveRecoveryPage(w, r, state, http.StatusServiceUnavailable, options.shouldInject())
				return
			}
			proxy.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(state) // Delivery is best-effort.
	case "restart":
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "Use POST to restart", http.StatusMethodNotAllowed)
			return
		}
		if options.Restart == nil || !options.GetRecovery().CanRestart {
			http.Error(w, "Service cannot be restarted right now", http.StatusConflict)
			return
		}
		if err := options.Restart(); err != nil {
			http.Error(w, err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "Unknown recovery action", http.StatusBadRequest)
	}
}

func renderUnavailableDocument() (string, error) {
	return statuspage.Render(statuspage.Page{
		Kind: "unavailable", Status: http.StatusBadGateway, Title: "Service unavailable",
		Message: "Use devhost to view logs and restart it.",
	}, "")
}
