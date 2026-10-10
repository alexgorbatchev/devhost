package manifest

import (
	"fmt"
	"net/url"
)

// ValidateHealthHTTPURL checks the concrete target after service templates resolve.
func ValidateHealthHTTPURL(serviceName string, rawURL string) error {
	parsedURL, err := url.Parse(rawURL)
	if err != nil || !parsedURL.IsAbs() || parsedURL.Host == "" {
		return fmt.Errorf("services.%s.health.http must be an absolute URL, received: %s", serviceName, rawURL)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return fmt.Errorf("services.%s.health.http must use http or https.", serviceName)
	}

	hostname := parsedURL.Hostname()
	if hostname != "127.0.0.1" && hostname != "localhost" && hostname != "::1" {
		return fmt.Errorf("services.%s.health.http must target 127.0.0.1, localhost, or ::1.", serviceName)
	}
	return nil
}
