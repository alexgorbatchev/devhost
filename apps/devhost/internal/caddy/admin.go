package caddy

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const caddyAdminTimeout = time.Second

type AdminAvailabilityDependencies struct {
	HTTPClient *http.Client
}

func EnsureManagedCaddyAdminAvailable(adminAPIURL string, dependencies AdminAvailabilityDependencies) error {
	httpClient := dependencies.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{}
	}

	requestContext, cancel := context.WithTimeout(context.Background(), caddyAdminTimeout)
	defer cancel()

	request, error := http.NewRequestWithContext(requestContext, http.MethodGet, adminAPIURL, nil)
	if error != nil {
		return errors.New(CreateManagedCaddyAdminUnavailableErrorMessage(error.Error()))
	}

	response, error := httpClient.Do(request)
	if error != nil {
		return errors.New(CreateManagedCaddyAdminUnavailableErrorMessage(error.Error()))
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		detail := strings.TrimSpace(fmt.Sprintf("HTTP %s", response.Status))
		return errors.New(CreateManagedCaddyAdminUnavailableErrorMessage(detail))
	}

	return nil
}

func CreateManagedCaddyAdminUnavailableErrorMessage(detail string) string {
	baseMessage := "Caddy admin API is not available. Run 'devhost caddy start' first."
	normalizedDetail := normalizeManagedCaddyAdminErrorDetail(detail)
	if normalizedDetail == "" {
		return baseMessage
	}

	return baseMessage + "\ndetail: " + normalizedDetail
}

func normalizeManagedCaddyAdminErrorDetail(detail string) string {
	trimmedDetail := strings.TrimSpace(strings.ReplaceAll(detail, " Is the computer able to access the url?", ""))
	return trimmedDetail
}
