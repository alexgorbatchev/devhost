package devtools

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestDocumentInjectionServerRewritesHTMLDocuments(t *testing.T) {
	t.Parallel()

	observedHeaders := map[string]string{}
	backendServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		observedHeaders["host"] = request.Host
		observedHeaders["x-devhost-injected"] = request.Header.Get("x-devhost-injected")
		observedHeaders["x-forwarded-host"] = request.Header.Get("x-forwarded-host")
		observedHeaders["x-forwarded-proto"] = request.Header.Get("x-forwarded-proto")
		if request.URL.Path == "/styles.css" {
			writer.Header().Set("content-type", "text/css; charset=utf-8")
			_, _ = writer.Write([]byte("body{color:red}"))
			return
		}

		writer.Header().Set("content-type", "text/html; charset=utf-8")
		writer.Header().Set("content-security-policy", "default-src 'self'")
		writer.Header().Set("content-security-policy-report-only", "default-src 'self'")
		_, _ = writer.Write([]byte("<html><body><main>hello</main></body></html>"))
	}))
	defer backendServer.Close()

	backendHost, backendPortText, error := net.SplitHostPort(backendServer.Listener.Addr().String())
	if error != nil {
		t.Fatalf("SplitHostPort(...) error = %v", error)
	}
	backendPort, error := strconv.Atoi(backendPortText)
	if error != nil {
		t.Fatalf("Atoi(...) error = %v", error)
	}

	documentServer, error := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
		BackendHost: backendHost,
		BackendPort: backendPort,
	})
	if error != nil {
		t.Fatalf("StartDocumentInjectionServer(...) error = %v", error)
	}
	t.Cleanup(func() {
		_ = documentServer.Stop()
	})

	serverAddress := net.JoinHostPort("127.0.0.1", strconv.Itoa(documentServer.Port()))
	listenerAddress := documentServer.listener.Addr().String()
	if listenerAddress != serverAddress {
		t.Fatalf("document injection listener = %q, want %q", listenerAddress, serverAddress)
	}
	if documentServer.Port() == backendPort {
		t.Fatalf("document injection port = %d, want distinct ephemeral port", documentServer.Port())
	}

	htmlRequest, error := http.NewRequest(http.MethodGet, serverURL(documentServer.Port(), "/"), nil)
	if error != nil {
		t.Fatalf("NewRequest(html) error = %v", error)
	}
	htmlRequest.Host = "hello.localhost"
	htmlResponse, error := http.DefaultClient.Do(htmlRequest)
	if error != nil {
		t.Fatalf("Do(html request) error = %v", error)
	}
	defer htmlResponse.Body.Close()
	htmlBody := readResponseText(t, htmlResponse)
	if htmlBody != `<html><body><main>hello</main><script type="module" src="/__devhost__/inject.js"></script></body></html>` {
		t.Fatalf("html response body = %q", htmlBody)
	}
	if htmlResponse.Header.Get("content-security-policy") != "" {
		t.Fatalf("content-security-policy = %q, want empty", htmlResponse.Header.Get("content-security-policy"))
	}
	if htmlResponse.Header.Get("content-security-policy-report-only") != "" {
		t.Fatalf("content-security-policy-report-only = %q, want empty", htmlResponse.Header.Get("content-security-policy-report-only"))
	}
	if htmlResponse.Header.Get("content-length") != "" {
		t.Fatalf("content-length = %q, want empty", htmlResponse.Header.Get("content-length"))
	}
	if observedHeaders["host"] != backendServer.Listener.Addr().String() {
		t.Fatalf("upstream host = %q, want %q", observedHeaders["host"], backendServer.Listener.Addr().String())
	}
	if observedHeaders["x-devhost-injected"] != "true" {
		t.Fatalf("x-devhost-injected = %q, want true", observedHeaders["x-devhost-injected"])
	}
	if observedHeaders["x-forwarded-host"] != "hello.localhost" {
		t.Fatalf("x-forwarded-host = %q, want hello.localhost", observedHeaders["x-forwarded-host"])
	}
	if observedHeaders["x-forwarded-proto"] != "https" {
		t.Fatalf("x-forwarded-proto = %q, want https", observedHeaders["x-forwarded-proto"])
	}

	cssRequest, error := http.NewRequest(http.MethodGet, serverURL(documentServer.Port(), "/styles.css"), nil)
	if error != nil {
		t.Fatalf("NewRequest(css) error = %v", error)
	}
	cssRequest.Host = "hello.localhost"
	cssResponse, error := http.DefaultClient.Do(cssRequest)
	if error != nil {
		t.Fatalf("Do(css request) error = %v", error)
	}
	defer cssResponse.Body.Close()
	if cssBody := readResponseText(t, cssResponse); cssBody != "body{color:red}" {
		t.Fatalf("css response body = %q, want raw upstream css", cssBody)
	}
}
