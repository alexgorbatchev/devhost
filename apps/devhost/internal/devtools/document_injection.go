package devtools

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"
	"sync"
	"time"
)

type StartDocumentInjectionServerOptions struct {
	BackendHost      string
	BackendPort      int
	DisableInjection bool
	GetRecovery      func() RecoveryState
	Restart          func() error
}

type DocumentInjectionServer struct {
	listener net.Listener
	server   *http.Server

	serverWG       sync.WaitGroup
	backendMu      sync.RWMutex
	backendAddress string
}

func StartDocumentInjectionServer(options StartDocumentInjectionServerOptions) (*DocumentInjectionServer, error) {
	listener, listenError := net.Listen("tcp", "127.0.0.1:0")
	if listenError != nil {
		return nil, fmt.Errorf("start document injection listener: %w", listenError)
	}

	documentServer := &DocumentInjectionServer{listener: listener}
	documentServer.SetBackend(options.BackendHost, options.BackendPort)
	proxy := &httputil.ReverseProxy{
		Director: func(request *http.Request) {
			requestHost := request.Host
			request.URL.Scheme = "http"
			documentServer.backendMu.RLock()
			request.URL.Host = documentServer.backendAddress
			documentServer.backendMu.RUnlock()
			request.Host = ""
			request.Header.Del("Accept-Encoding")
			request.Header.Del("Host")
			request.Header.Set("x-devhost-injected", "true")
			request.Header.Set("x-forwarded-host", requestHost)
			request.Header.Set("x-forwarded-proto", "https")
		},
		ModifyResponse: func(response *http.Response) error {
			if options.GetRecovery != nil && response.Request.Header.Get(recoveryHeader) == "probe" {
				// An upstream HTTP response, including an application error or redirect,
				// proves document transport works. Keep the probe from navigating or
				// downloading the app before the browser performs its real navigation.
				_ = response.Body.Close()
				response.Body, response.ContentLength = http.NoBody, 0
				response.StatusCode = http.StatusNoContent
				response.Header = http.Header{"Cache-Control": []string{"no-store"}}
				return nil
			}
			if options.DisableInjection || !isHTMLResponse(response) {
				return nil
			}

			body, err := io.ReadAll(response.Body)
			if err != nil {
				return err
			}
			_ = response.Body.Close()

			rewrittenBody := injectDevtoolsScript(string(body))
			response.Body = io.NopCloser(strings.NewReader(rewrittenBody))
			response.ContentLength = -1
			response.Header.Del("content-security-policy")
			response.Header.Del("content-security-policy-report-only")
			response.Header.Del("content-length")
			return nil
		},
		ErrorHandler: func(writer http.ResponseWriter, request *http.Request, err error) {
			if options.GetRecovery != nil {
				state := options.GetRecovery()
				state.Phase, state.Title = "unavailable", state.Service+" could not load"
				state.Message = "The service could not return a document: " + err.Error()
				serveRecoveryPage(writer, request, state, http.StatusBadGateway, !options.DisableInjection)
				return
			}
			writer.Header().Set("cache-control", "no-store")
			writer.Header().Set("content-type", "text/html; charset=utf-8")
			writer.WriteHeader(http.StatusBadGateway)
			// Keep the injected control UI available when a document's backend is down.
			// A disconnected browser cannot receive the recovery response, so delivery is best-effort.
			_, _ = io.WriteString(writer, injectDevtoolsScript(`<!doctype html><html><head><meta charset="utf-8"><title>Service unavailable · devhost</title></head><body data-devhost-recovery><p>Service unavailable. Use devhost to view logs and restart it.</p></body></html>`))
		},
	}

	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if options.GetRecovery != nil {
			if r.Header.Get(recoveryHeader) != "" {
				serveRecoveryControl(w, r, options, proxy)
				return
			}
			state := options.GetRecovery()
			if state.Phase != "ready" {
				serveRecoveryPage(w, r, state, http.StatusServiceUnavailable, !options.DisableInjection)
				return
			}
		}
		proxy.ServeHTTP(w, r)
	})}
	documentServer.server = server
	documentServer.serverWG.Add(1)
	go func() {
		defer documentServer.serverWG.Done()
		if serveError := server.Serve(listener); serveError != nil && serveError != http.ErrServerClosed {
			return
		}
	}()

	return documentServer, nil
}

func (s *DocumentInjectionServer) SetBackend(host string, port int) {
	s.backendMu.Lock()
	defer s.backendMu.Unlock()
	s.backendAddress = net.JoinHostPort(host, strconv.Itoa(port))
}

func (s *DocumentInjectionServer) Port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *DocumentInjectionServer) Stop() error {
	shutdownContext, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	shutdownError := s.server.Shutdown(shutdownContext)
	s.serverWG.Wait()
	return shutdownError
}

func isHTMLResponse(response *http.Response) bool {
	return strings.Contains(response.Header.Get("content-type"), "text/html")
}

func injectDevtoolsScript(document string) string {
	const injectedTag = `<script type="module" src="` + injectedScriptPath + `"></script>`

	lowerDocument := strings.ToLower(document)
	closingBodyIndex := strings.LastIndex(lowerDocument, "</body>")
	if closingBodyIndex == -1 {
		return document + injectedTag
	}

	return document[:closingBodyIndex] + injectedTag + document[closingBodyIndex:]
}
