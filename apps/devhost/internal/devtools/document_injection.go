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
	BackendHost string
	BackendPort int
}

type DocumentInjectionServer struct {
	listener net.Listener
	server   *http.Server

	serverWG sync.WaitGroup
}

func StartDocumentInjectionServer(options StartDocumentInjectionServerOptions) (*DocumentInjectionServer, error) {
	listener, listenError := net.Listen("tcp", "127.0.0.1:0")
	if listenError != nil {
		return nil, fmt.Errorf("start document injection listener: %w", listenError)
	}

	backendAddress := net.JoinHostPort(options.BackendHost, strconv.Itoa(options.BackendPort))
	proxy := &httputil.ReverseProxy{
		Director: func(request *http.Request) {
			requestHost := request.Host
			request.URL.Scheme = "http"
			request.URL.Host = backendAddress
			request.Host = ""
			request.Header.Del("Accept-Encoding")
			request.Header.Del("Host")
			request.Header.Set("x-devhost-injected", "true")
			request.Header.Set("x-forwarded-host", requestHost)
			request.Header.Set("x-forwarded-proto", "https")
		},
		ModifyResponse: func(response *http.Response) error {
			if !isHTMLResponse(response) {
				return nil
			}

			body, error := io.ReadAll(response.Body)
			if error != nil {
				return error
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
	}

	server := &http.Server{Handler: proxy}
	documentServer := &DocumentInjectionServer{listener: listener, server: server}
	documentServer.serverWG.Add(1)
	go func() {
		defer documentServer.serverWG.Done()
		if serveError := server.Serve(listener); serveError != nil && serveError != http.ErrServerClosed {
			return
		}
	}()

	return documentServer, nil
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
