package nativebrowser

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResolveEndpoint(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, response string
		status         int
		wantErr        bool
	}{
		{"same browser", `{"webSocketDebuggerUrl":"ws://%s/devtools/browser/actual"}`, 200, false},
		{"changed port", `{"webSocketDebuggerUrl":"ws://127.0.0.1:1/devtools/browser/actual"}`, 200, true},
		{"remote host", `{"webSocketDebuggerUrl":"ws://example.com:9222/devtools/browser/actual"}`, 200, true},
		{"page session", `{"webSocketDebuggerUrl":"ws://%s/devtools/page/actual"}`, 200, true},
		{"missing browser", `{}`, 200, true},
		{"redirect", `{}`, 302, true},
		{"too large", strings.Repeat(" ", maxEndpointMetadataBytes+1), 200, true},
		{"trailing value", `{"webSocketDebuggerUrl":"ws://%s/devtools/browser/actual"} {}`, 200, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/json/version" || r.Method != http.MethodGet {
					t.Errorf("unexpected discovery request %s %s", r.Method, r.URL.Path)
				}
				w.Header().Set("Location", "http://example.com/")
				w.WriteHeader(tc.status)
				text := strings.ReplaceAll(tc.response, "%s", r.Host)
				if _, err := fmt.Fprint(w, text); err != nil {
					t.Errorf("write discovery: %v", err)
				}
			}))
			defer server.Close()
			got, err := ResolveEndpoint(context.Background(), server.URL)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ResolveEndpoint = %q, %v; wantErr %v", got, err, tc.wantErr)
			}
			if !tc.wantErr && got != strings.Replace(server.URL, "http://", "ws://", 1)+"/devtools/browser/actual" {
				t.Fatalf("wrong browser endpoint %q", got)
			}
		})
	}
}
