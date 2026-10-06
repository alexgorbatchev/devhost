package devtools

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRestartStackRequiresPostAndReportsOutcome(t *testing.T) {
	for _, tc := range []struct {
		name, method string
		restart      func() error
		status       int
		called       bool
	}{
		{"get", http.MethodGet, func() error { return nil }, http.StatusMethodNotAllowed, false},
		{"unsupported", http.MethodPost, nil, http.StatusNotImplemented, false},
		{"failed", http.MethodPost, func() error { return errors.New("replacement failed") }, http.StatusInternalServerError, true},
		{"success without credentials", http.MethodPost, func() error { return nil }, http.StatusNoContent, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			s := &ControlServer{}
			if tc.restart != nil {
				s.restartStack = func() error { called = true; return tc.restart() }
			}
			request := httptest.NewRequest(tc.method, restartStackPath, nil)
			response := httptest.NewRecorder()
			s.handleRestartStack(response, request)
			if response.Code != tc.status || called != tc.called {
				t.Fatalf("status %d, called %t; want %d, %t", response.Code, called, tc.status, tc.called)
			}
			if tc.status == http.StatusMethodNotAllowed && response.Header().Get("Allow") != http.MethodPost {
				t.Fatal("missing Allow: POST")
			}
			if tc.status == http.StatusInternalServerError && strings.TrimSpace(response.Body.String()) != "replacement failed" {
				t.Fatal("restart error was not returned")
			}
		})
	}
}
