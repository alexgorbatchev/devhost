package devtools

import (
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
)

type RoutingConfig struct {
	RoutedServices []RoutedServiceIdentity `json:"routedServices"`
	PrimaryService string                  `json:"primaryService"`
}

// UpdateRouting preserves the control listener, connected clients, and sessions.
func (s *ControlServer) UpdateRouting(routes []RoutedServiceIdentity, primary string) error {
	s.mu.Lock()
	var config injectedConfig
	if err := json.Unmarshal(s.configJSON, &config); err != nil {
		s.mu.Unlock()
		return fmt.Errorf("read injected routing configuration: %w", err)
	}
	config.RoutedServices, config.PrimaryService = slices.Clone(routes), primary
	encoded, err := json.Marshal(config)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("encode injected routing configuration: %w", err)
	}
	s.configJSON = encoded
	s.routedServices, s.primaryService = slices.Clone(routes), primary
	s.mu.Unlock()
	return nil
}

func resolveRoutedServiceForURL(routedServices []RoutedServiceIdentity, urlText string) *RoutedServiceIdentity {
	parsedURL, err := url.Parse(urlText)
	if err != nil || parsedURL.Hostname() == "" {
		return nil
	}

	var bestMatch *RoutedServiceIdentity
	bestMatchWeight := -1 << 30
	for index := range routedServices {
		service := routedServices[index]
		if strings.ToLower(service.Host) != strings.ToLower(parsedURL.Hostname()) {
			continue
		}
		normalizedPath := normalizeRoutedServicePath(service.Path)
		if !doesRoutedServiceMatchPath(normalizedPath, parsedURL.Path) {
			continue
		}
		matchWeight := routedServicePathWeight(normalizedPath)
		if bestMatch == nil || matchWeight > bestMatchWeight || (matchWeight == bestMatchWeight && service.ServiceName < bestMatch.ServiceName) {
			candidate := service
			bestMatch = &candidate
			bestMatchWeight = matchWeight
		}
	}
	return bestMatch
}

func normalizeRoutedServicePath(path string) string {
	if path == "" || path == "/" || path == "/*" {
		return "/"
	}
	return path
}

func doesRoutedServiceMatchPath(routePath string, pathname string) bool {
	if routePath == "/" {
		return true
	}
	if strings.HasSuffix(routePath, "/*") {
		basePath := strings.TrimSuffix(routePath, "/*")
		return strings.HasPrefix(pathname, basePath+"/")
	}
	return pathname == routePath
}

func routedServicePathWeight(path string) int {
	if path == "/" {
		return -1
	}
	if strings.HasSuffix(path, "/*") {
		return len(strings.TrimSuffix(path, "/*")) * 10
	}
	return len(path)*10 + 1
}
