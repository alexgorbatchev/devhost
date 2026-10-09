package devtools

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

func TestStartServiceRequiresPostAndReportsOutcome(t *testing.T) {
	succeed := func([]string) error { return nil }
	for _, tc := range []struct {
		name, method, body string
		start              func([]string) error
		status             int
		wantNames          []string
	}{
		{name: "get", method: http.MethodGet, body: `{"serviceNames":["docs"]}`, start: succeed, status: http.StatusMethodNotAllowed},
		{name: "malformed body", method: http.MethodPost, body: `{`, start: succeed, status: http.StatusBadRequest},
		{name: "no services", method: http.MethodPost, body: `{"serviceNames":[]}`, start: succeed, status: http.StatusBadRequest},
		{name: "unsupported", method: http.MethodPost, body: `{"serviceNames":["docs"]}`, status: http.StatusNotImplemented},
		{
			name: "failed", method: http.MethodPost, body: `{"serviceNames":["docs"]}`,
			start:  func([]string) error { return errors.New("service docs is already started") },
			status: http.StatusInternalServerError, wantNames: []string{"docs"},
		},
		{name: "success", method: http.MethodPost, body: `{"serviceNames":["docs","api"]}`, start: succeed, status: http.StatusNoContent, wantNames: []string{"docs", "api"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var gotNames []string
			s := &ControlServer{}
			if tc.start != nil {
				s.startService = func(names []string) error { gotNames = names; return tc.start(names) }
			}
			request := httptest.NewRequest(tc.method, startServicePath, strings.NewReader(tc.body))
			response := httptest.NewRecorder()
			s.handleStartService(response, request)
			if response.Code != tc.status || !slices.Equal(gotNames, tc.wantNames) {
				t.Fatalf("status %d, started %q; want %d, %q", response.Code, gotNames, tc.status, tc.wantNames)
			}
			if tc.status == http.StatusMethodNotAllowed && response.Header().Get("Allow") != http.MethodPost {
				t.Fatal("missing Allow: POST")
			}
			if tc.status == http.StatusInternalServerError && strings.TrimSpace(response.Body.String()) != "service docs is already started" {
				t.Fatalf("start error was not returned: %q", response.Body.String())
			}
		})
	}
}
