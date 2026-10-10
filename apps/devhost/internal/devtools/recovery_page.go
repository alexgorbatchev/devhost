package devtools

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"html/template"
	"io"
	"net/http"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/statuspage"
)

const recoveryHeader = "X-Devhost-Recovery"

// RecoveryState is the service lifecycle snapshot served independently of the toolbar.
type RecoveryState struct {
	Stack      string   `json:"stack"`
	Service    string   `json:"service"`
	Phase      string   `json:"phase"`
	Title      string   `json:"title"`
	Message    string   `json:"message"`
	Address    string   `json:"address"`
	CanRestart bool     `json:"canRestart"`
	Logs       []string `json:"logs"`
}

//go:embed recovery_page.html
var recoveryDocument string

var recoveryTemplate = template.Must(template.New("recovery").Parse(recoveryDocument))

type recoveryPageData struct {
	RecoveryState
	Status int
	Styles template.CSS
}

func serveRecoveryPage(w http.ResponseWriter, r *http.Request, state RecoveryState, status int, injectToolbar bool) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Header.Get("Sec-Fetch-Dest") != "document" && strings.Contains(r.Header.Get("Accept"), "application/json") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(state) // Delivery to a disconnected client is best-effort.
		return
	}
	var body bytes.Buffer
	// The trusted stylesheet is embedded at build time; service data remains escaped.
	page := recoveryPageData{RecoveryState: state, Status: status, Styles: template.CSS(statuspage.CSS)}
	if err := recoveryTemplate.Execute(&body, page); err != nil {
		http.Error(w, "Unable to render service status", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		document := body.String()
		if injectToolbar {
			document = injectDevtoolsScript(document)
		}
		_, _ = io.WriteString(w, document) // Delivery to a disconnected client is best-effort.
	}
}

func serveRecoveryControl(w http.ResponseWriter, r *http.Request, options StartDocumentInjectionServerOptions, proxy http.Handler) {
	w.Header().Set("Cache-Control", "no-store")
	origins := r.Header.Values("Origin")
	if len(origins) > 0 && (len(origins) != 1 || (origins[0] != "https://"+r.Host && origins[0] != "http://"+r.Host)) {
		http.Error(w, "Origin does not match the routed host", http.StatusForbidden)
		return
	}
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		http.Error(w, "Recovery requires the routed host", http.StatusForbidden)
		return
	}
	switch r.Header.Get(recoveryHeader) {
	case "status", "probe":
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "Use GET for service status", http.StatusMethodNotAllowed)
			return
		}
		state := options.GetRecovery()
		if r.Header.Get(recoveryHeader) == "probe" {
			if state.Phase != "ready" {
				serveRecoveryPage(w, r, state, http.StatusServiceUnavailable, !options.DisableInjection)
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
		if len(origins) != 1 || (origins[0] != "https://"+r.Host && origins[0] != "http://"+r.Host) {
			http.Error(w, "Origin does not match the routed host", http.StatusForbidden)
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
