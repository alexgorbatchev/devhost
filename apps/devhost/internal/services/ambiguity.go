package services

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
)

const (
	defaultLoopbackBindWarningHTTPSPort = 443
	probeTimeoutDuration                = 750 * time.Millisecond
)

type loopbackProbe struct {
	Location *string
	Status   int
}

type loopbackWarningDependencies struct {
	probeHTTPResponse func(string, int) *loopbackProbe
}

func ReadLoopbackBindHostAmbiguityWarning(service ResolvedService, httpsPort int) string {
	return readLoopbackBindHostAmbiguityWarning(service, httpsPort, loopbackWarningDependencies{
		probeHTTPResponse: probeHTTPResponse,
	})
}

func readLoopbackBindHostAmbiguityWarning(service ResolvedService, httpsPort int, dependencies loopbackWarningDependencies) string {
	if service.Host == nil || service.Port == nil {
		return ""
	}

	proxyHost, error := caddy.ResolveProxyHost(service.BindHost)
	if error != nil {
		return ""
	}

	preferredBindHost := readAlternativeBindHost(service.BindHost)
	if preferredBindHost == "" {
		return ""
	}

	if httpsPort == 0 {
		httpsPort = defaultLoopbackBindWarningHTTPSPort
	}

	probe := dependencies.probeHTTPResponse
	if probe == nil {
		probe = probeHTTPResponse
	}

	localhostProbe := probe("localhost", *service.Port)
	routedProbe := probe(proxyHost, *service.Port)
	if localhostProbe == nil || routedProbe == nil || areLoopbackProbesEqual(*localhostProbe, *routedProbe) {
		return ""
	}

	preferredProxyHost, error := caddy.ResolveProxyHost(preferredBindHost)
	if error != nil {
		return ""
	}

	preferredProbe := probe(preferredProxyHost, *service.Port)
	recommendation := " Set services.<name>.bindHost explicitly to match the listener your app prints."
	if preferredProbe != nil && areLoopbackProbesEqual(*localhostProbe, *preferredProbe) {
		recommendation = fmt.Sprintf(" Consider setting services.%s.bindHost = %q.", service.Name, preferredBindHost)
	}

	managedCaddyURL := strings.TrimSuffix(caddy.CreateManagedCaddyURL("https", *service.Host, httpsPort, "/"), "/")
	return fmt.Sprintf(
		"services.%s.port = %d is ambiguous: http://localhost:%d/ responded differently than http://%s/. devhost routes %s through %s:%d, so a localhost URL may hit a different loopback listener on this machine.%s",
		service.Name,
		*service.Port,
		*service.Port,
		caddy.FormatProxyAddress(proxyHost, *service.Port),
		managedCaddyURL,
		service.BindHost,
		*service.Port,
		recommendation,
	)
}

func probeHTTPResponse(host string, port int) *loopbackProbe {
	client := &http.Client{
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Timeout: probeTimeoutDuration,
	}

	response, error := client.Get(fmt.Sprintf("http://%s/", caddy.FormatProxyAddress(host, port)))
	if error != nil {
		return nil
	}
	defer response.Body.Close()

	var location *string
	if value := response.Header.Get("Location"); value != "" {
		location = copyStringPointer(value)
	}

	return &loopbackProbe{Location: location, Status: response.StatusCode}
}

func areLoopbackProbesEqual(left loopbackProbe, right loopbackProbe) bool {
	leftLocation := ""
	if left.Location != nil {
		leftLocation = *left.Location
	}

	rightLocation := ""
	if right.Location != nil {
		rightLocation = *right.Location
	}

	return left.Status == right.Status && leftLocation == rightLocation
}

func readAlternativeBindHost(bindHost string) string {
	if bindHost == "127.0.0.1" || bindHost == "0.0.0.0" {
		return "::1"
	}

	if bindHost == "::1" || bindHost == "::" {
		return "127.0.0.1"
	}

	return ""
}
