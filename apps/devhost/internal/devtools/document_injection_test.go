package devtools

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"golang.org/x/sys/unix"
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

	backendHost, backendPortText, err := net.SplitHostPort(backendServer.Listener.Addr().String())
	if err != nil {
		t.Fatalf("SplitHostPort(...) error = %v", err)
	}
	backendPort, err := strconv.Atoi(backendPortText)
	if err != nil {
		t.Fatalf("Atoi(...) error = %v", err)
	}

	documentServer, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{
		BackendHost: backendHost,
		BackendPort: backendPort,
	})
	if err != nil {
		t.Fatalf("StartDocumentInjectionServer(...) error = %v", err)
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

	htmlRequest, err := http.NewRequest(http.MethodGet, serverURL(documentServer.Port(), "/"), nil)
	if err != nil {
		t.Fatalf("NewRequest(html) error = %v", err)
	}
	htmlRequest.Host = "hello.localhost"
	htmlResponse, err := http.DefaultClient.Do(htmlRequest)
	if err != nil {
		t.Fatalf("Do(html request) error = %v", err)
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

	cssRequest, err := http.NewRequest(http.MethodGet, serverURL(documentServer.Port(), "/styles.css"), nil)
	if err != nil {
		t.Fatalf("NewRequest(css) error = %v", err)
	}
	cssRequest.Host = "hello.localhost"
	cssResponse, err := http.DefaultClient.Do(cssRequest)
	if err != nil {
		t.Fatalf("Do(css request) error = %v", err)
	}
	defer cssResponse.Body.Close()
	if cssBody := readResponseText(t, cssResponse); cssBody != "body{color:red}" {
		t.Fatalf("css response body = %q, want raw upstream css", cssBody)
	}
}

func TestDocumentInjectionBackendCanChangeDuringRequests(t *testing.T) {
	t.Parallel()
	backend := func(text string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("content-type", "text/html")
			_, _ = w.Write([]byte(text))
		}))
	}
	first, second := backend("first"), backend("second")
	defer first.Close()
	defer second.Close()
	firstAddress, secondAddress := first.Listener.Addr().(*net.TCPAddr), second.Listener.Addr().(*net.TCPAddr)
	server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{BackendHost: firstAddress.IP.String(), BackendPort: firstAddress.Port})
	if err != nil {
		t.Fatal(err)
	}
	defer server.Stop()
	url := serverURL(server.Port(), "/")
	var wg sync.WaitGroup
	for range 4 {
		wg.Go(func() {
			for range 20 {
				response, err := http.Get(url)
				if err != nil {
					t.Error(err)
					return
				}
				data, err := io.ReadAll(response.Body)
				response.Body.Close()
				if err != nil {
					t.Error(err)
					return
				}
				body := string(data)
				if response.StatusCode != http.StatusOK || (body != injectDevtoolsScript("first") && body != injectDevtoolsScript("second")) {
					t.Errorf("unexpected proxy response: %d %q", response.StatusCode, body)
				}
			}
		})
	}
	for range 40 {
		server.SetBackend(secondAddress.IP.String(), secondAddress.Port)
		server.SetBackend(firstAddress.IP.String(), firstAddress.Port)
	}
	wg.Wait()
	server.SetBackend(secondAddress.IP.String(), secondAddress.Port)
	response, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if body := readResponseText(t, response); body != injectDevtoolsScript("second") {
		t.Fatalf("updated backend response = %q", body)
	}
}

func TestDocumentInjectionServerServesRecoveryPageWhenBackendExits(t *testing.T) {
	t.Parallel()
	// An exited backend refuses connections.
	address := reserveRefusingTCPAddress(t)
	server, err := StartDocumentInjectionServer(StartDocumentInjectionServerOptions{BackendHost: address.IP.String(), BackendPort: address.Port})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Stop() })
	response, err := http.Get(serverURL(server.Port(), "/deep/link?value=1"))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", response.StatusCode)
	}
	if response.Header.Get("cache-control") != "no-store" {
		t.Fatalf("cache-control = %q", response.Header.Get("cache-control"))
	}
	if response.Header.Get("content-type") != "text/html; charset=utf-8" {
		t.Fatalf("content-type = %q", response.Header.Get("content-type"))
	}
	want := `<!doctype html><html><head><meta charset="utf-8"><title>Service unavailable · devhost</title></head><body data-devhost-recovery><p>Service unavailable. Use devhost to view logs and restart it.</p><script type="module" src="/__devhost__/inject.js"></script></body></html>`
	if body := readResponseText(t, response); body != want {
		t.Fatalf("recovery body = %q", body)
	}
}

// reserveRefusingTCPAddress binds a loopback TCP port without listening on it. Connections to it are refused, and
// unlike the port of a server that was just closed, nothing else can start listening there while the test runs.
func reserveRefusingTCPAddress(t *testing.T) *net.TCPAddr {
	t.Helper()

	socket, err := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatalf("Socket(...) error = %v", err)
	}
	t.Cleanup(func() { _ = unix.Close(socket) })
	if err := unix.Bind(socket, &unix.SockaddrInet4{Addr: [4]byte{127, 0, 0, 1}}); err != nil {
		t.Fatalf("Bind(...) error = %v", err)
	}
	address, err := unix.Getsockname(socket)
	if err != nil {
		t.Fatalf("Getsockname(...) error = %v", err)
	}
	boundAddress, ok := address.(*unix.SockaddrInet4)
	if !ok {
		t.Fatalf("bound address = %#v, want IPv4", address)
	}
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: boundAddress.Port}
}
