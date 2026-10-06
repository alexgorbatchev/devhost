package devtools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/nativebrowser"
	"github.com/gorilla/websocket"
)

const nativeBrowserWebsocketPath = controlPathPrefix + "/ws/native-browser"
const nativeBrowserProtocol = "devhost-native-browser.v1"
const nativeMessageLimit = 16 * 1024
const nativeRequestQueueSize = 16
const nativeHandshakeTimeout = 5 * time.Second
const nativeWriteTimeout = 2 * time.Second

var nativeIdentityPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)
var nativeRequestIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func nativeRequestOrigin(r *http.Request) (string, error) {
	origins := r.Header.Values("Origin")
	if len(origins) != 1 {
		return "", fmt.Errorf("one Origin is required")
	}
	u, err := url.Parse(origins[0])
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Opaque != "" || u.Path != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(origins[0], "#") || !strings.EqualFold(u.Host, r.Host) || u.Hostname() == "" {
		return "", fmt.Errorf("Origin must match the request authority")
	}
	return u.String(), nil
}

func decodeNativeRequest(data []byte) (nativebrowser.Request, error) {
	var request nativebrowser.Request
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return request, fmt.Errorf("one native request is required")
	}
	if !nativeRequestIDPattern.MatchString(request.ID) || !nativeIdentityPattern.MatchString(request.Binding.InstanceID) || !nativeIdentityPattern.MatchString(request.Binding.DocumentID) || request.Binding.Href == "" {
		return request, fmt.Errorf("invalid native request identity")
	}
	return request, nil
}

func (s *ControlServer) handleNativeBrowserWebsocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET required", http.StatusMethodNotAllowed)
		return
	}
	origin, err := nativeRequestOrigin(r)
	protocols := websocket.Subprotocols(r)
	if err != nil || len(protocols) != 1 || protocols[0] != nativeBrowserProtocol {
		http.Error(w, "Native browser origin or protocol rejected", http.StatusForbidden)
		return
	}
	if s.nativeBrowser.Endpoint == "" || !s.featureToggles.ExternalToolbarsEnabled || s.allowsNativeBrowserURL == nil {
		http.Error(w, "Native browser control is not configured", http.StatusServiceUnavailable)
		return
	}
	allowed, err := s.allowsNativeBrowserURL(s.Port(), origin+"/")
	if err != nil || !allowed {
		http.Error(w, "Native browser origin is not an active project route", http.StatusForbidden)
		return
	}
	s.mu.Lock()
	if s.isStopped {
		s.mu.Unlock()
		http.Error(w, "Devhost is stopping", http.StatusServiceUnavailable)
		return
	}
	s.serverWG.Add(1)
	s.mu.Unlock()
	defer s.serverWG.Done()
	upgrader := websocket.Upgrader{HandshakeTimeout: nativeHandshakeTimeout, Subprotocols: []string{nativeBrowserProtocol}, CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	s.tracker.IncrementActive()
	defer s.tracker.DecrementActive()
	ctx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	conn.SetReadLimit(nativeMessageLimit)
	closeDone := make(chan struct{})
	go func() {
		defer close(closeDone)
		<-ctx.Done()
		_ = conn.Close() // Cancellation releases the socket even when its peer has already closed it.
	}()
	defer func() { cancel(); <-closeDone }()
	if err := conn.SetReadDeadline(time.Now().Add(nativeHandshakeTimeout)); err != nil {
		return
	}
	_, data, err := conn.ReadMessage()
	if err != nil {
		return
	}
	first, err := decodeNativeRequest(data)
	if err != nil || first.Command != "connect" || first.Binding.InstanceID != s.nativeBrowserInstanceID {
		return
	}
	href, err := url.Parse(first.Binding.Href)
	if err != nil || href.Scheme+"://"+href.Host != origin {
		return
	}
	allowed, err = s.allowsNativeBrowserURL(s.Port(), first.Binding.Href)
	if err != nil || !allowed {
		return
	}
	if err := conn.SetReadDeadline(time.Time{}); err != nil {
		return
	}
	requests := make(chan nativebrowser.Request, nativeRequestQueueSize)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer cancel()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			request, err := decodeNativeRequest(data)
			if err != nil {
				return
			}
			select {
			case requests <- request:
			case <-ctx.Done():
				return
			default:
				return // A flooded connection releases its lease rather than dropping commands.
			}
		}
	}()
	defer func() { cancel(); <-readDone }()
	publish := func(update nativebrowser.Update) error {
		if err := conn.SetWriteDeadline(time.Now().Add(nativeWriteTimeout)); err != nil {
			return err
		}
		return conn.WriteJSON(update)
	}
	options := nativebrowser.Options{
		Endpoint:         s.nativeBrowser.Endpoint,
		ReactExtensionID: s.nativeBrowser.ReactExtensionID,
		InitialRequestID: first.ID,
		AllowsURL:        func(href string) (bool, error) { return s.allowsNativeBrowserURL(s.Port(), href) },
	}
	if err := nativebrowser.Run(ctx, options, first.Binding, requests, publish); err != nil && ctx.Err() == nil {
		// Errors exposed here are deliberate actionable messages; library errors
		// containing the server-only browser endpoint never enter the UI transport.
		_ = publish(nativebrowser.Update{Type: "error", ID: first.ID, Error: err.Error()}) // Connection closure is the final error signal if writing also fails.
	}
}
