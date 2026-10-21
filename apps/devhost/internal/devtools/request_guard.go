package devtools

import (
	"mime"
	"net"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
)

const jsonMediaType = "application/json"

// crossOriginProtection refuses state changes a browser sends from another origin, for the control server and for the
// recovery controls served on a service's own host.
var crossOriginProtection = http.NewCrossOriginProtection()

// guardControlRequests keeps pages on other sites from changing the stack or reading its configuration files.
// Cross-site requests are rejected by the standard CSRF protection and by the websocket origin check; a page whose own
// name was rebound to this listener's address passes both, because its requests are same-origin, so its Host must
// also be one this stack serves.
func (s *ControlServer) guardControlRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isStateChangingRequest(request) && !strings.HasPrefix(request.URL.Path, configPathPrefix) {
			next.ServeHTTP(writer, request)
			return
		}
		if err := crossOriginProtection.Check(request); err != nil {
			http.Error(writer, err.Error(), http.StatusForbidden)
			return
		}
		if !s.servesRequestHost(request) {
			http.Error(writer, "The request host is not a route of this stack.", http.StatusForbidden)
			return
		}
		if hasRequestBody(request) && !isJSONRequest(request) {
			http.Error(writer, "Request bodies must be "+jsonMediaType+".", http.StatusUnsupportedMediaType)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

// isStateChangingRequest covers the unsafe methods and websocket upgrades, whose sockets accept commands.
func isStateChangingRequest(request *http.Request) bool {
	switch request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return websocket.IsWebSocketUpgrade(request)
	}
	return true
}

// servesRequestHost accepts the loopback names local tools use to reach the listener directly,
// and the routed hosts whose /__devhost__/ requests Caddy sends to this stack.
func (s *ControlServer) servesRequestHost(request *http.Request) bool {
	hostname := request.Host
	if host, _, err := net.SplitHostPort(request.Host); err == nil {
		hostname = host
	}
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	if ip := net.ParseIP(hostname); ip != nil {
		return ip.IsLoopback()
	}
	if s.ownsDocumentURL == nil {
		return false
	}
	owned, err := s.ownsDocumentURL(s.Port(), requestDocumentOrigin(request)+"/")
	return err == nil && owned
}

// requestDocumentOrigin is the origin of the page the request was addressed to. Caddy names the scheme the browser
// used; a request without that header reached the loopback listener directly, which serves plain HTTP.
func requestDocumentOrigin(request *http.Request) string {
	scheme := "http"
	if request.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + request.Host
}

func hasRequestBody(request *http.Request) bool {
	return request.ContentLength != 0
}

func isJSONRequest(request *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	return err == nil && mediaType == jsonMediaType
}
