package devtools

import (
	"net/url"
	"strings"
)

// resolveRoutedServiceForURL finds the service whose route serves urlText: the longest matching path on its host,
// with a more specific exact path winning over a prefix of the same length.
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
