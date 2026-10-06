package nativebrowser

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const endpointDiscoveryTimeout = 2 * time.Second
const maxEndpointMetadataBytes = 64 * 1024

// ResolveEndpoint validates discovery before giving a full browser WebSocket
// to remote.NewAllocator with NoModifyURL. Redirects, proxies and a changed
// loopback authority cannot move browser control to a different server.
func ResolveEndpoint(ctx context.Context, text string) (string, error) {
	u, err := ParseEndpoint(text)
	if err != nil {
		return "", err
	}
	if u.Scheme == "ws" {
		return u.String(), nil
	}
	discovery := *u
	discovery.Path = "/json/version"
	transport := &http.Transport{}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport:     transport,
		Timeout:       endpointDiscoveryTimeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, discovery.String(), nil)
	if err != nil {
		return "", fmt.Errorf("create browser discovery request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("browser discovery is unavailable")
	}
	defer resp.Body.Close() // No connection is retained after this bounded discovery.
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("browser discovery returned HTTP %d", resp.StatusCode)
	}
	bytes, err := io.ReadAll(io.LimitReader(resp.Body, maxEndpointMetadataBytes+1))
	if err != nil {
		return "", fmt.Errorf("read browser discovery: %w", err)
	}
	if len(bytes) > maxEndpointMetadataBytes {
		return "", fmt.Errorf("browser discovery exceeds the metadata limit")
	}
	var metadata struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.Unmarshal(bytes, &metadata); err != nil {
		return "", fmt.Errorf("decode browser discovery: %w", err)
	}
	ws, err := ParseEndpoint(metadata.WebSocketDebuggerURL)
	if err != nil || ws.Scheme != "ws" || ws.Hostname() != u.Hostname() || ws.Port() != u.Port() {
		return "", fmt.Errorf("browser discovery must return a browser WebSocket on the configured loopback address and port")
	}
	return ws.String(), nil
}
