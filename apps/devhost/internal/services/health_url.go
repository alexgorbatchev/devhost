package services

import (
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/alexgorbatchev/devhost/apps/devhost/internal/caddy"
	"github.com/alexgorbatchev/devhost/apps/devhost/internal/manifest"
)

func buildServiceURL(service ResolvedService) (*url.URL, error) {
	if service.Port == nil {
		return nil, fmt.Errorf("service %q does not have a port", service.Name)
	}
	host, err := caddy.ResolveProxyHost(service.BindHost)
	if err != nil {
		return nil, err
	}
	return &url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(*service.Port))}, nil
}

func resolveHealthURL(name, raw string, services map[string]ResolvedService) (string, error) {
	resolved, err := interpolateServiceTemplates(raw, services)
	if err != nil {
		return "", fmt.Errorf("services.%s.health.http: %w", name, err)
	}
	if strings.Contains(resolved, "{{") || strings.Contains(resolved, "}}") {
		return "", fmt.Errorf("services.%s.health.http contains an unresolved URL template: %s", name, resolved)
	}
	if strings.HasPrefix(resolved, "/") && !strings.HasPrefix(resolved, "//") {
		base, err := buildServiceURL(services[name])
		if err != nil {
			return "", err
		}
		path, err := url.Parse(resolved)
		if err != nil {
			return "", fmt.Errorf("services.%s.health.http must be a valid URL path: %w", name, err)
		}
		resolved = base.ResolveReference(path).String()
	}
	if err := manifest.ValidateHealthHTTPURL(name, resolved); err != nil {
		return "", err
	}
	return resolved, nil
}
